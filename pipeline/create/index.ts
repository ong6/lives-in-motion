/**
 * The /create runner: one life at a time, made by the same stages as `pnpm make`, inside the
 * server process (the runner framework is pipeline/jobs/). The subject screen decides first
 * whether the life is made at all; then research, storyboard, and plate 1 (the style
 * reference), then the other scenes, each going plate → SAM 3.1 cut-outs → clean background →
 * line drawing as soon as its plate lands; the frontispiece is made alongside; the films are
 * rendered locally in a child process; then Muse Wonder directs each illustrated film and
 * critiques it (one revision at most), in a second child process, replacing the fixed moves it
 * beats. Nothing is written to stories/ until the subject screen has passed the name.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { lifeCost } from "../../lib/cost";
import { BudgetError, STOP, entries, spent, withScope } from "../budget";
import { MODELS } from "../meta";
import { frontispiece } from "../portrait";
import { ROOT } from "../root";
import { isRefusal, loadStory, research, storyDir, storyboard, type Fact } from "../stages";
import { LIFE_CEILING, jobTag, mockForced, preflight, rails, uniqueSlug, validateInput, validatePhoto, type Refusal } from "../jobs/guard";
import { createRunner, friendly } from "../jobs/runner";
import { child, emblemSource, jobScenes, reencodePhoto, runFilms, runScenes, showSource, slugTaken, writeCredit } from "../jobs/steps";
import { rehearse } from "./rehearsal";
import { Declined, check } from "./screen";
import { DIRECT_PARALLEL, DIRECT_ROUNDS, STEP_ORDER, type CreateInfo, type Job, type StepId } from "./types";

/**
 * Typical wall time per step in seconds, from the first real run (Tan Howe Liang, 2026-10-30:
 * research 44 s, storyboard 20 s, plates 20–50 s each, Muse Image clean-background edits 30 s to
 * 3 min each, films 7 s a scene). The cut-outs overlap the plates. Direct: Muse Wonder takes about
 * 30 s a round (plan or critique, plus a local render) and up to two rounds a scene; six scenes,
 * two at a time, from the ledger's 2026-10-30 Wonder runs.
 */
export const ESTIMATE: Record<StepId, number> = { screen: 20, research: 50, storyboard: 25, plates: 160, cutouts: 200, frontispiece: 40, films: 50, direct: 200 };

/** Every step a job has, including ones added since an old job.json was written. */
function withAllSteps(job: Job): Job {
  const steps = job.steps as Partial<Job["steps"]>;
  for (const id of STEP_ORDER)
    steps[id] ??= {
      // A job written before a step existed passed it by.
      status: (id === "screen" && steps.research?.status !== "waiting") || (id === "direct" && steps.films?.status !== undefined && steps.films.status !== "waiting" && steps.films.status !== "running") ? "skipped" : "waiting",
      usd: 0,
    };
  return job;
}

export const runner = createRunner<StepId, Job>({
  key: "__limCreate",
  file: (slug) => join(storyDir(slug), "job.json"),
  label: "a life",
  // Nothing is written for a rehearsal, or for a name until the subject screen has passed it.
  persists: (job) => !(job.mock || job.status === "declined" || job.steps.screen?.status === "waiting" || job.steps.screen?.status === "running"),
  upgrade: withAllSteps,
  failedAt: () => "research",
  stopped: (e) =>
    e instanceof Declined
      ? (j) => {
          j.status = "declined";
          j.finishedAt = new Date().toISOString();
          j.screen = { ...e.result };
          j.steps.screen.status = "declined";
          j.steps.screen.endedAt = j.finishedAt;
          j.log.push({ at: j.finishedAt, step: "screen", kind: "refused", model: MODELS.spark, message: `declined: ${(e.result.refused === "category" || !e.result.refused ? e.result.category : e.result.refused).replace(/_/g, " ")}` });
        }
      : undefined,
});
const { getJob, busy, subscribe, update, log, step, scoped, onStage, launch } = runner;
export { getJob, busy, subscribe };

// ---------- Reading ----------

export function info(): CreateInfo {
  return { ...rails("Making new lives is switched off on this server."), estimate: ESTIMATE, typical: typical(), job: runner.state.job };
}

/** The typical cost of a life (lib/cost.ts), as the form quotes it. */
function typical(): CreateInfo["typical"] {
  const c = lifeCost(ROOT);
  return { usd: c.usd, label: c.label, basis: c.basis, wonderPerScene: c.wonderPerScene, direct: c.parts.direct };
}

/**
 * The life a rehearsal replays, under its own name and hint (never the typed one). Jack Sim:
 * a social entrepreneur, made with every stage of the pipeline.
 */
export const REHEARSAL = { slug: "jack-sim", hint: "social entrepreneur, founder of the World Toilet Organization" };

function newJob(o: { slug: string; name: string; hint: string; photo: boolean; mock?: boolean; bookSlug?: string }): Job {
  const now = new Date().toISOString();
  return {
    slug: o.slug,
    name: o.name,
    hint: o.hint,
    photo: o.photo,
    mock: o.mock,
    bookSlug: o.bookSlug ?? o.slug,
    // Lives made on /create go straight onto the shelf; `pnpm approve --withdraw <slug>` takes one down.
    draft: false,
    status: "running",
    startedAt: now,
    updatedAt: now,
    steps: Object.fromEntries(STEP_ORDER.map((s) => [s, { status: "waiting", usd: 0 }])) as Job["steps"],
    facts: [],
    scenes: [],
    usd: 0,
    ceiling: LIFE_CEILING,
    spend: {},
    models: { spark: MODELS.spark, image: MODELS.image, sam: MODELS.sam, wonder: MODELS.wonder },
    log: [],
  };
}

// ---------- Starting ----------

export interface StartRequest {
  name: unknown;
  hint: unknown;
  photo?: { type: string; size: number; bytes: Uint8Array } | null;
  token?: string | null;
  mock?: boolean;
  /** Pick up an interrupted or failed life where it stopped. */
  resume?: string | null;
}

export async function start(req: StartRequest): Promise<{ ok: true; slug: string } | ({ ok: false } & Refusal)> {
  const mock = Boolean(req.mock) || mockForced();
  const refused = preflight({ entries: entries(), left: STOP - spent(), busy: busy(), token: req.token, mock });
  if (refused) return { ok: false, ...refused };

  // A rehearsal needs no name: it replays a finished life under that life's own name and hint.
  if (mock && !req.resume) {
    const story = await loadStory(REHEARSAL.slug);
    const slug = `rehearsal-${Date.now().toString(36)}`;
    launch(newJob({ slug, name: story.name, hint: REHEARSAL.hint, photo: false, mock: true, bookSlug: REHEARSAL.slug }), () => rehearse(runner, REHEARSAL.slug));
    return { ok: true, slug };
  }

  if (req.resume) {
    const old = getJob(req.resume);
    if (!old || old.mock) return { ok: false, status: 404, error: "There is no unfinished life by that name to pick up." };
    if (old.status === "done" && !Object.values(old.steps).some((x) => x.status === "failed") && !old.scenes.some((x) => x.cuts.length && !x.background))
      return { ok: false, status: 409, error: "That life is already finished." };
    const job = { ...newJob(old), screen: old.screen, facts: old.facts, scenes: old.scenes, usd: old.usd, spend: old.spend, log: old.log, startedAt: old.startedAt, steps: old.steps };
    for (const s of Object.values(job.steps)) if (s.status !== "done") Object.assign(s, { status: "waiting", startedAt: undefined, endedAt: undefined, note: undefined });
    launch(job, () => runReal(job.slug, null, null));
    log({ step: "research", kind: "info", message: "picked up where the last run stopped; finished work is kept" });
    return { ok: true, slug: job.slug };
  }

  const v = validateInput(req.name, req.hint);
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  let photo: { bytes: Uint8Array; type: string } | null = null;
  if (req.photo && req.photo.size > 0) {
    const p = validatePhoto(req.photo);
    if (!p.ok) return { ok: false, status: 400, error: p.error };
    photo = { bytes: req.photo.bytes, type: p.type };
  }

  const slug = uniqueSlug(v.value.name, slugTaken);
  launch(newJob({ slug, name: v.value.name, hint: v.value.hint || "Singaporean", photo: Boolean(photo) }), () => runReal(slug, v.value, photo));
  return { ok: true, slug };
}

// ---------- The real run ----------

async function runReal(slug: string, input: { name: string; hint: string } | null, photo: { bytes: Uint8Array } | null) {
  await withScope(runner.spendScope(slug), async () => {
    const job = runner.live();
    const dir = storyDir(slug);

    // Subject screen: one small Muse Spark call decides whether this life is made at all.
    if (job.steps.screen.status !== "done") {
      step("screen", "running");
      log({ step: "screen", kind: "info", model: MODELS.spark, message: `searching the web to confirm who ${job.name} is before any research` });
      const r = await scoped("screen", undefined, () => check(input?.name ?? job.name, input?.hint ?? job.hint));
      if (!r.ok) throw new Declined(r);
      update((j) => void (j.screen = r));
      log({ step: "screen", kind: "info", model: MODELS.spark, message: `${r.known_for || r.category.replace(/_/g, " ")}: confirmed by ${r.check?.independent ?? 0} independent sources, go ahead` });
      step("screen", "done", r.category.replace(/_/g, " "));
    }
    await mkdir(join(dir, "source"), { recursive: true });
    if (photo) await reencodePhoto(photo.bytes, join(dir, "source/photo.jpg"));

    // Research: Muse Spark + web search, every fact with its url citations.
    step("research", "running");
    if (existsSync(join(dir, "research.json"))) {
      const r = JSON.parse(await readFile(join(dir, "research.json"), "utf8"));
      update((j) => void (j.facts = r.facts));
    } else
      await scoped("research", undefined, () =>
        research(slug, input?.name ?? job.name, input?.hint || job.hint || "Singaporean", onStage("research", (j, e) => e.kind === "facts" && (j.facts = e.data as Fact[]))),
      );
    step("research", "done");

    // Storyboard: Muse Spark structured output → story.json, which the site can already show.
    step("storyboard", "running");
    if (!existsSync(join(dir, "story.json"))) await scoped("storyboard", undefined, () => storyboard(slug, onStage("storyboard"), { listed: true }));
    const story = await loadStory(slug);
    update((j) => Object.assign(j, { tagline: story.tagline, born: story.born, died: story.died, scenes: jobScenes(story, j.scenes) }));
    step("storyboard", "done");

    await Promise.all([runScenes(runner, slug), frontRun(slug)]);
    await runFilms(runner, slug);
    await directRun(slug);
    await writeCredit(
      slug,
      job.photo
        ? { kind: "reader-photo", text: "Traced from a photo supplied by the reader.", masked: "SAM 3.1" }
        : { kind: "emblem", text: "Frontispiece: an emblem of the life painted by Muse Image, cut out with SAM 3.1 and traced in pen lines. Not a likeness.", masked: "SAM 3.1" },
    );
  });
}

/** The frontispiece: the reader's photo (SAM 3.1 person mask) or a Muse Image emblem (SAM 3.1 object mask), traced by linedraw. */
async function frontRun(slug: string) {
  const job = runner.live();
  step("frontispiece", "running");
  update((j) => void (j.frontispiece = { kind: job.photo ? "photo" : "emblem" }));
  try {
    await scoped("frontispiece", undefined, async () => {
      const { file, concept } = job.photo
        ? { file: join(storyDir(slug), "source/photo.jpg"), concept: "person" }
        : await emblemSource(slug, `an object that stands for the life of ${job.name}`, (emblem) =>
            log({ step: "frontispiece", kind: "info", model: MODELS.image, message: `painting an emblem: ${emblem.concept}` }),
          );
      const shown = await showSource(slug, sharp(file).rotate().resize(700, 900, { fit: "inside" }));
      update((j) => void (j.frontispiece!.image = shown));
      log({ step: "frontispiece", kind: "asset", model: job.photo ? undefined : MODELS.image, message: job.photo ? "your photo, ready to trace" : "emblem", url: shown });
      log({ step: "frontispiece", kind: "info", model: MODELS.sam, message: `masking the ${concept}, then tracing it in pen lines` });
      const p = await frontispiece(slug, file, concept, { kind: job.photo ? "reader-photo" : "emblem", license: job.photo ? "Supplied by the reader" : "Generated with Muse Image", artist: job.photo ? "the reader" : "Muse Image" });
      update((j) => Object.assign(j.frontispiece!, { lines: `/lines/${slug}.json`, strokes: p.strokes.length, note: p.credit.masked === "none" ? "SAM 3.1 found nothing to cut out; traced the whole picture" : undefined }));
      log({ step: "frontispiece", kind: "asset", message: `traced in ${p.strokes.length} strokes`, url: p.photo });
    });
    step("frontispiece", "done");
  } catch (e) {
    if (e instanceof BudgetError) throw e;
    const msg = isRefusal(e) ? "Muse Image declined the emblem under its content policy; the book opens without a frontispiece" : `no frontispiece: ${friendly(e)}`;
    update((j) => void (j.frontispiece!.note = msg));
    log({ step: "frontispiece", kind: isRefusal(e) ? "refused" : "error", message: msg });
    step("frontispiece", "failed", msg);
  }
}

/**
 * Muse Wonder directs each illustrated film, then critiques six frames of it, with at most one
 * revision a scene (pnpm wonder in a child process, so the local renders don't block the server).
 * Its spend is tagged to this life and held under its ceiling; a published film replaces the
 * fixed move in story.json. Optional: if Wonder fails or the ceiling stops it, the fixed-move films
 * stay and the life is still finished.
 */
async function directRun(slug: string) {
  const todo = runner.live().scenes.filter((s) => s.plate && s.treatment !== "line" && s.video);
  if (!todo.length) return step("direct", "skipped", "no films to direct");
  step("direct", "running");
  update((j) => {
    for (const sc of j.scenes) if (todo.some((t) => t.id === sc.id)) sc.wonder = { status: "directing" };
  });
  log({ step: "direct", kind: "info", model: MODELS.wonder, message: `Muse Wonder plans a move for ${todo.length} films, watches each one and asks for one revision at most` });
  let directed = 0, stopped = "";
  const args = ["pipeline/wonder.ts", slug, "--rounds", String(DIRECT_ROUNDS), "--parallel", String(DIRECT_PARALLEL), "--job", jobTag(slug), "--limit", String(LIFE_CEILING), "--events", "--publish", "--scenes", todo.map((t) => t.id).join(",")];
  const code = await child(
    args,
    (l) => {
      if (!l.startsWith("@@")) return;
      let e: any;
      try {
        e = JSON.parse(l.slice(2));
      } catch {
        return;
      }
      if (e.type === "spend") runner.fake("direct", e.scene, e.kind, e.usd);
      else if (e.type === "log") log({ step: "direct", scene: e.scene, kind: "info", model: MODELS.wonder, message: String(e.message).slice(0, 300) });
      else if (e.type === "budget") {
        stopped = "the life's ceiling stopped Muse Wonder; the remaining films keep their fixed move";
        log({ step: "direct", scene: e.scene, kind: "warn", message: stopped });
      } else if (e.type === "scene") {
        const r = e.report;
        if (r.status === "directed") directed++;
        update((j) => {
          const sc = runner.scene(j, e.scene);
          if (!sc) return;
          sc.wonder = { status: r.status, score: r.score, passed: r.passed, rationale: r.rationale, verdict: r.verdict, rounds: r.rounds, usd: r.usd, note: r.error ?? r.note };
          if (r.status === "directed" && r.video) Object.assign(sc, { video: r.video, poster: r.poster });
        });
        const what = r.status === "directed" ? `directed, critic ${r.score}/10${r.passed ? "" : " (below the pass mark of 8, still better than the fixed move)"}` : r.status === "failed" ? `not directed: ${friendly(r.error)}` : `fixed move kept (${r.note ?? `critic ${r.score}/10`})`;
        log({ step: "direct", scene: e.scene, kind: r.status === "failed" ? "warn" : "info", model: MODELS.wonder, message: what });
      }
    },
    (text) => log({ step: "direct", kind: "warn", message: text }),
  );
  update((j) => {
    for (const sc of j.scenes) if (sc.wonder?.status === "directing") sc.wonder = { status: "kept-fixed-move", note: stopped || "not reached" };
  });
  if (code !== 0) return step("direct", "failed", "Muse Wonder stopped; the films keep their fixed move");
  step("direct", "done", `${directed} of ${todo.length} films directed${stopped ? "; ceiling reached" : ""}`);
}
