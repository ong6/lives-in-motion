/**
 * The /create job runner: one life at a time, made by the same stages as `pnpm make`, inside the
 * server process. Plate 1 is painted first (it is the style reference), then the other six
 * scenes run three at a time, each going plate → SAM 3.1 cut-outs → clean background → line
 * drawing as soon as its plate lands; the frontispiece is made alongside; the films are rendered
 * locally in a child process; then Muse Wonder directs each illustrated film and critiques it
 * (one revision at most), in a second child process, replacing the fixed moves it beats.
 *
 * State lives on globalThis (it survives hot reloads) and in stories/<slug>/job.json (it
 * survives a refresh, and tells a restarted server the run was interrupted). Every paid call is
 * tagged `create:<slug>` in the ledger and capped by the life's ceiling in the budget guard.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { BudgetError, PRICES, STOP, entries, spent, withScope, type Entry, type SpendScope } from "../budget";
import { MODELS, museImage } from "../meta";
import { frontispiece } from "../portrait";
import { emblemPrompt } from "../prompts";
import { Declined, check, independentSources } from "./screen";
import { ROOT } from "../root";
import { lifeCost } from "../../lib/cost";
import {
  asset,
  illustrateScene,
  isRefusal,
  lineScene,
  loadStory,
  pool,
  research,
  segmentScene,
  storyDir,
  storyboard,
  type Emblem,
  type Fact,
  type StageEvent,
} from "../stages";
import { LIFE_CEILING, dailyCap, jobTag, mockForced, preflight, spentToday, uniqueSlug, validateInput, validatePhoto, type Refusal, createEnabled, mockAllowed, tokenOk } from "./guard";
import type { Budget, CreateInfo, Job, JobLog, JobScene, Spend, StepId } from "./types";

/**
 * Typical wall time per step in seconds, from the first real run (Tan Howe Liang, 2026-10-30:
 * research 44 s, storyboard 20 s, plates 20–50 s each, Muse Image clean-background edits 30 s to
 * 3 min each, films 7 s a scene). The cut-outs overlap the plates. Direct: Muse Wonder takes about
 * 30 s a round (plan or critique, plus a local render) and up to two rounds a scene; six scenes,
 * two at a time, from the ledger's 2026-10-30 Wonder runs.
 */
export const ESTIMATE: Record<StepId, number> = { screen: 20, research: 50, storyboard: 25, plates: 160, cutouts: 200, frontispiece: 40, films: 50, direct: 200 };
/** Scenes Muse Wonder directs at once, and the revisions it may ask for per scene on /create. */
const DIRECT_PARALLEL = 2;
const DIRECT_ROUNDS = 1;
/** Scenes worked on at once after plate 1. */
const PARALLEL = 3;

interface State {
  job: Job | null;
  running: boolean;
  listeners: Set<(job: Job) => void>;
  timer?: ReturnType<typeof setTimeout>;
}
const G = globalThis as unknown as { __limCreate?: State };
const state: State = (G.__limCreate ??= { job: null, running: false, listeners: new Set() });

const jobFile = (slug: string) => join(storyDir(slug), "job.json");

// ---------- Reading ----------

export function budget(): Budget {
  const all = entries();
  const total = spent();
  return { spent: total, stop: STOP, left: STOP - total, today: spentToday(all), dailyCap: dailyCap() };
}

export function info(): CreateInfo {
  const env = process.env;
  return {
    enabled: createEnabled(env),
    reason: createEnabled(env) ? undefined : "Making new lives is switched off on this server.",
    needsToken: Boolean(env.CREATE_TOKEN),
    mockAllowed: mockAllowed(env),
    budget: budget(),
    ceiling: LIFE_CEILING,
    estimate: ESTIMATE,
    typical: typical(),
    job: state.job,
  };
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

/** Every step a job has, including ones added since an old job.json was written. */
export function withAllSteps(job: Job): Job {
  const steps = job.steps as Partial<Job["steps"]>;
  for (const id of ["screen", "research", "storyboard", "plates", "cutouts", "frontispiece", "films", "direct"] as StepId[])
    steps[id] ??= {
      // A job written before a step existed passed it by.
      status: (id === "screen" && steps.research?.status !== "waiting") || (id === "direct" && steps.films?.status !== undefined && steps.films.status !== "waiting" && steps.films.status !== "running") ? "skipped" : "waiting",
      usd: 0,
    };
  return job;
}

/** The job for a slug: the live one, else its job.json (a "running" file with no runner was interrupted). */
export function getJob(slug: string): Job | null {
  if (state.job?.slug === slug) return state.job;
  const f = jobFile(slug);
  if (!existsSync(f)) return null;
  try {
    const job = withAllSteps(JSON.parse(readFileSync(f, "utf8")) as Job);
    if (job.status === "running") job.status = "interrupted";
    return job;
  } catch {
    return null;
  }
}

export const busy = () => (state.running ? (state.job?.slug ?? "a life") : null);

export function subscribe(fn: (job: Job) => void): () => void {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

// ---------- Writing ----------

function persist(job: Job) {
  // Nothing is written for a rehearsal, or for a name until the subject screen has passed it.
  if (job.mock || job.status === "declined" || job.steps.screen?.status === "waiting" || job.steps.screen?.status === "running") return;
  const f = jobFile(job.slug);
  const tmp = `${f}.tmp`;
  mkdir(storyDir(job.slug), { recursive: true })
    .then(() => writeFile(tmp, JSON.stringify(job, null, 1)))
    .then(() => rename(tmp, f))
    .catch(() => {});
}

/** Change the live job, then (throttled) save it and tell every open stream. */
function update(fn: (job: Job) => void, flush = false) {
  const job = state.job;
  if (!job) return;
  fn(job);
  job.updatedAt = new Date().toISOString();
  if (job.log.length > 300) job.log.splice(0, job.log.length - 300);
  const send = () => {
    state.timer = undefined;
    persist(job);
    for (const l of state.listeners) l(job);
  };
  if (flush) {
    clearTimeout(state.timer);
    send();
  } else state.timer ??= setTimeout(send, 250);
}

const log = (entry: Omit<JobLog, "at">) => update((j) => j.log.push({ at: new Date().toISOString(), ...entry }));

function step(id: StepId, status: Job["steps"][StepId]["status"], note?: string) {
  update((j) => {
    const s = j.steps[id];
    // A resumed run passes through finished steps without restarting their clocks.
    if (s.status === "done" && (status === "running" || status === "done")) return;
    if (status === "running") s.startedAt ??= new Date().toISOString();
    else if (status !== "waiting") s.endedAt = new Date().toISOString();
    s.status = status;
    if (note) s.note = note;
  });
}

const scene = (j: Job, id?: string) => j.scenes.find((s) => s.id === id);
const add = (spend: Spend, kind: Entry["kind"], usd: number) => (spend[kind] = +((spend[kind] ?? 0) + usd).toFixed(6));

/** Ledger spend inside this scope also lands on the step (and scene) it was made for. */
const scoped = <T>(stepId: StepId, sceneId: string | undefined, fn: () => Promise<T>) =>
  withScope(
    {
      onSpend: (e) =>
        update((j) => {
          j.steps[stepId].usd = +(j.steps[stepId].usd + e.usd).toFixed(6);
          const sc = scene(j, sceneId);
          if (sc) add(sc.spend, e.kind, e.usd);
        }),
      onRetry: (message) => log({ step: stepId, scene: sceneId, kind: "retry", message }),
    },
    fn,
  );

/** Stage events → the job's picture of the life. */
function onStage(stepId: StepId) {
  return (e: StageEvent) =>
    update((j) => {
      const sc = scene(j, e.scene);
      if (e.kind === "facts") j.facts = e.data as Fact[];
      if (e.kind === "plate" && sc) Object.assign(sc, { plate: e.url, status: sc.status === "waiting" || sc.status === "painting" ? "painted" : sc.status });
      if (e.kind === "refused" && sc && e.stage === "illustrate") Object.assign(sc, { status: "refused", note: e.message });
      if (e.kind === "cut" && sc) {
        const d = e.data as JobScene["cuts"][number];
        sc.cuts.push({ concept: d.concept, src: d.src, x: d.x, y: d.y, w: d.w });
      }
      if (e.kind === "background" && sc) sc.background = e.url;
      if (e.kind === "line" && sc) sc.line = e.url;
      const kind: JobLog["kind"] = e.kind === "warn" || e.kind === "error" || e.kind === "refused" ? (e.kind === "refused" ? "refused" : e.kind) : e.url ? "asset" : "info";
      j.log.push({ at: new Date().toISOString(), step: stepId, scene: e.scene, kind, message: e.message, model: e.model, url: e.url });
    });
}

function newJob(o: { slug: string; name: string; hint: string; photo: boolean; mock?: boolean; bookSlug?: string }): Job {
  const now = new Date().toISOString();
  const steps = Object.fromEntries((["screen", "research", "storyboard", "plates", "cutouts", "frontispiece", "films", "direct"] as StepId[]).map((s) => [s, { status: "waiting", usd: 0 }])) as Job["steps"];
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
    steps,
    facts: [],
    scenes: [],
    usd: 0,
    ceiling: LIFE_CEILING,
    spend: {},
    models: { ...MODELS },
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
    launch(newJob({ slug, name: story.name, hint: REHEARSAL.hint, photo: false, mock: true, bookSlug: REHEARSAL.slug }), () => runMock());
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

  const slug = uniqueSlug(v.value.name, (s) => existsSync(storyDir(s)) || existsSync(join(ROOT, "public/stories", s)) || existsSync(join(ROOT, "public/lines", `${s}.json`)));
  const job = newJob({ slug, name: v.value.name, hint: v.value.hint || "Singaporean", photo: Boolean(photo) });
  // Nothing is written to stories/ until the subject screen has passed the name.
  launch(job, () => runReal(slug, v.value, photo));
  return { ok: true, slug };
}

function launch(job: Job, run: () => Promise<void>) {
  state.job = job;
  state.running = true;
  update(() => {}, true);
  void (async () => {
    try {
      await run();
      update((j) => {
        j.status = "done";
        j.finishedAt = new Date().toISOString();
      }, true);
    } catch (e) {
      if (e instanceof Declined) {
        update((j) => {
          j.status = "declined";
          j.finishedAt = new Date().toISOString();
          j.screen = { ...e.result };
          j.steps.screen.status = "declined";
          j.steps.screen.endedAt = j.finishedAt;
          j.log.push({ at: j.finishedAt, step: "screen", kind: "refused", model: MODELS.spark, message: `declined: ${(e.result.refused === "category" || !e.result.refused ? e.result.category : e.result.refused).replace(/_/g, " ")}` });
        }, true);
        return;
      }
      const budgetStop = e instanceof BudgetError;
      update((j) => {
        j.status = "failed";
        j.finishedAt = new Date().toISOString();
        j.error = budgetStop ? String(e.message).replace(/^budget: /, "Budget guard: ") : friendly(e);
        for (const s of Object.values(j.steps)) if (s.status === "running") s.status = "failed";
        j.log.push({ at: new Date().toISOString(), step: "research", kind: "error", message: j.error });
      }, true);
    } finally {
      state.running = false;
      update(() => {}, true);
    }
  })();
}

// ---------- The real run ----------

async function runReal(slug: string, input: { name: string; hint: string } | null, photo: { bytes: Uint8Array } | null) {
  const scope: SpendScope = {
    job: jobTag(slug),
    limit: LIFE_CEILING,
    onSpend: (e) =>
      update((j) => {
        j.usd = +(j.usd + e.usd).toFixed(6);
        add(j.spend, e.kind, e.usd);
      }),
  };
  await withScope(scope, async () => {
    const job = state.job!;
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
    if (photo) {
      // Re-encoded, which also drops EXIF (camera, GPS) from the reader's file.
      await sharp(Buffer.from(photo.bytes)).rotate().resize(2000, 2000, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toFile(join(dir, "source/photo.jpg"));
    }

    // Research: Muse Spark + web search, every fact with its url citations.
    step("research", "running");
    if (existsSync(join(dir, "research.json"))) {
      const r = JSON.parse(await readFile(join(dir, "research.json"), "utf8"));
      update((j) => void (j.facts = r.facts));
    } else await scoped("research", undefined, () => research(slug, input?.name ?? job.name, input?.hint || job.hint || "Singaporean", onStage("research")));
    step("research", "done");

    // Storyboard: Muse Spark structured output → story.json, which the site can already show.
    step("storyboard", "running");
    if (!existsSync(join(dir, "story.json"))) await scoped("storyboard", undefined, () => storyboard(slug, onStage("storyboard"), { listed: true }));
    const story = await loadStory(slug);
    update((j) => {
      j.tagline = story.tagline;
      j.born = story.born;
      j.died = story.died;
      const old = new Map(j.scenes.map((s) => [s.id, s]));
      j.scenes = story.scenes.map((s) => ({
        id: s.id,
        year: s.year,
        title: s.title,
        caption: s.caption,
        treatment: s.treatment,
        // Cut-outs without their clean background go round again to retry the background.
        status: s.layers.some((l) => l.src) && s.background ? "done" : s.plate ? "painted" : "waiting",
        plate: s.plate,
        background: s.background,
        line: s.line,
        poster: s.poster,
        video: s.video,
        cuts: s.layers.filter((l) => l.src).map((l) => ({ concept: l.concept, src: l.src!, x: l.x, y: l.y, w: l.w })),
        note: old.get(s.id)?.note,
        spend: old.get(s.id)?.spend ?? {},
      }));
    });
    step("storyboard", "done");

    await Promise.all([scenesRun(slug), frontRun(slug)]);
    await filmsRun(slug);
    await directRun(slug);
    await writeFile(join(dir, "credit.json"), JSON.stringify(creditFor(job), null, 2) + "\n");
  });
}

function creditFor(job: Job) {
  return job.photo
    ? { kind: "reader-photo", text: "Traced from a photo supplied by the reader.", masked: "SAM 3.1" }
    : { kind: "emblem", text: "Frontispiece: an emblem of the life painted by Muse Image, cut out with SAM 3.1 and traced in pen lines. Not a likeness.", masked: "SAM 3.1" };
}

/** Run at most n of the given tasks at once. */
function limiter(n: number) {
  let live = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    // A finishing task hands its slot straight to the next in line, so n is never exceeded.
    if (live >= n) await new Promise<void>((r) => waiting.push(r));
    else live++;
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else live--;
    }
  };
}

/** Plates, cut-outs and line drawings, pipelined per scene. */
async function scenesRun(slug: string) {
  const ids = state.job!.scenes.map((s) => s.id);
  step("plates", "running");
  const setStatus = (id: string, status: JobScene["status"], note?: string) =>
    update((j) => {
      const sc = scene(j, id);
      if (sc && sc.status !== "refused") Object.assign(sc, { status }, note ? { note } : {});
    });
  let platesLeft = ids.length;
  const plateDone = () => --platesLeft === 0 && step("plates", "done");

  const paint = async (id: string) => {
    setStatus(id, "painting");
    try {
      const ok = await scoped("plates", id, () => illustrateScene(slug, id, onStage("plates")));
      if (!ok) return false;
      setStatus(id, "painted");
      return true;
    } catch (e) {
      if (e instanceof BudgetError) throw e;
      setStatus(id, "failed", `Muse Image failed: ${friendly(e)}`);
      log({ step: "plates", scene: id, kind: "error", message: `plate failed: ${friendly(e)}` });
      return false;
    } finally {
      plateDone();
    }
  };
  const finish = async (id: string) => {
    if (state.job!.steps.cutouts.status === "waiting") step("cutouts", "running");
    setStatus(id, "cutting");
    try {
      await scoped("cutouts", id, () => segmentScene(slug, id, onStage("cutouts")));
      await scoped("cutouts", id, () => lineScene(slug, id, onStage("cutouts")));
      setStatus(id, "done");
    } catch (e) {
      if (e instanceof BudgetError) throw e;
      setStatus(id, "painted", `cut-outs failed: ${friendly(e)}`);
      log({ step: "cutouts", scene: id, kind: "error", message: `cut-outs failed: ${friendly(e)}` });
    }
  };
  // Two lanes: plates (three at a time) and cut-outs (three at a time). Muse Image's clean
  // background edit can take minutes, so it must not hold up the plates still to be painted.
  const finishing: Promise<void>[] = [];
  const lane = limiter(PARALLEL);
  const painted = async (id: string) => {
    const sc = scene(state.job!, id)!;
    if (sc.status === "done") return void plateDone();
    if (await paint(id)) finishing.push(lane(() => finish(id)));
  };
  // Plate 1 alone first: the other six use it as their style reference.
  const [first, ...rest] = ids;
  await painted(first);
  await pool(rest, PARALLEL, painted);
  await Promise.all(finishing);
  const refused = state.job!.scenes.filter((s) => s.status === "refused" || s.status === "failed").length;
  step("plates", refused === ids.length ? "failed" : "done", refused ? `${refused} of ${ids.length} scenes have no plate` : undefined);
  step("cutouts", state.job!.steps.cutouts.status === "waiting" ? "skipped" : "done");
}

/** The frontispiece: the reader's photo (SAM 3.1 person mask) or a Muse Image emblem (SAM 3.1 object mask), traced by linedraw. */
async function frontRun(slug: string) {
  const job = state.job!;
  const dir = storyDir(slug);
  step("frontispiece", "running");
  update((j) => void (j.frontispiece = { kind: job.photo ? "photo" : "emblem" }));
  try {
    await scoped("frontispiece", undefined, async () => {
      let file = join(dir, "source/photo.jpg"), concept = "person";
      if (!job.photo) {
        const emblem: Emblem = existsSync(join(dir, "emblem.json"))
          ? JSON.parse(await readFile(join(dir, "emblem.json"), "utf8"))
          : { visual: `an object that stands for the life of ${job.name}`, concept: "object" };
        concept = emblem.concept.split(/\s+/).slice(-2).join(" ") || "object";
        file = join(dir, "source/emblem.png");
        if (!existsSync(file)) {
          log({ step: "frontispiece", kind: "info", model: MODELS.image, message: `painting an emblem: ${emblem.concept}` });
          const png = await museImage(emblemPrompt(emblem.visual, emblem.concept), []);
          await writeFile(file, png);
        }
      }
      // Shown on the workbench while the lines are traced.
      const shown = asset(slug, "frontispiece", "source.webp");
      await mkdir(join(shown.file, ".."), { recursive: true });
      await sharp(file).rotate().resize(700, 900, { fit: "inside" }).webp({ quality: 80 }).toFile(shown.file);
      update((j) => void (j.frontispiece!.image = shown.url));
      log({ step: "frontispiece", kind: "asset", model: job.photo ? undefined : MODELS.image, message: job.photo ? "your photo, ready to trace" : "emblem", url: shown.url });
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

/** Scroll films, rendered locally (sharp + ffmpeg) by pnpm video in a child process. */
async function filmsRun(slug: string) {
  if (!state.job!.scenes.some((s) => s.plate && s.treatment !== "line")) return step("films", "skipped", "no plates to film");
  step("films", "running");
  log({ step: "films", kind: "info", message: "rendering scroll films on this machine (sharp + ffmpeg, no API calls)" });
  const tsx = join(ROOT, "node_modules/.bin/tsx");
  const code = await new Promise<number>((resolve) => {
    const child = spawn(tsx, ["pipeline/video.ts", slug], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d;
      const lines = buf.split("\n");
      buf = lines.pop()!;
      for (const l of lines) {
        const m = l.match(/^\s+(s\d+): (.+)$/);
        if (m) log({ step: "films", scene: m[1], kind: "info", message: m[2] });
      }
    });
    child.stderr.on("data", (d) => log({ step: "films", kind: "warn", message: String(d).trim().slice(0, 160) }));
    child.on("close", (c) => resolve(c ?? 1));
    child.on("error", () => resolve(1));
  });
  const story = await loadStory(slug);
  update((j) => {
    for (const s of story.scenes) Object.assign(scene(j, s.id) ?? {}, { video: s.video, poster: s.poster });
  });
  step("films", code === 0 ? "done" : "failed", code === 0 ? undefined : "the film renderer stopped; the book shows still plates instead");
}

/**
 * Muse Wonder directs each illustrated film, then critiques six frames of it, with at most one
 * revision a scene (pnpm wonder in a child process, so the local renders don't block the server).
 * Its spend is tagged to this life and held under its ceiling; a published film replaces the
 * fixed move in story.json. Optional: if Wonder fails or the ceiling stops it, the fixed-move films
 * stay and the life is still finished.
 */
async function directRun(slug: string) {
  const job = state.job!;
  const todo = job.scenes.filter((s) => s.plate && s.treatment !== "line" && s.video);
  if (!todo.length) return step("direct", "skipped", "no films to direct");
  step("direct", "running");
  update((j) => {
    for (const sc of j.scenes) if (todo.some((t) => t.id === sc.id)) sc.wonder = { status: "directing" };
  });
  log({ step: "direct", kind: "info", model: MODELS.wonder, message: `Muse Wonder plans a move for ${todo.length} films, watches each one and asks for one revision at most` });
  let directed = 0, stopped = "";
  const tsx = join(ROOT, "node_modules/.bin/tsx");
  const args = ["pipeline/wonder.ts", slug, "--rounds", String(DIRECT_ROUNDS), "--parallel", String(DIRECT_PARALLEL), "--job", jobTag(slug), "--limit", String(LIFE_CEILING), "--events", "--publish", "--scenes", todo.map((t) => t.id).join(",")];
  const code = await new Promise<number>((resolve) => {
    const child = spawn(tsx, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d;
      const lines = buf.split("\n");
      buf = lines.pop()!;
      for (const l of lines) {
        if (!l.startsWith("@@")) continue;
        let e: any;
        try {
          e = JSON.parse(l.slice(2));
        } catch {
          continue;
        }
        if (e.type === "spend")
          update((j) => {
            j.usd = +(j.usd + e.usd).toFixed(6);
            add(j.spend, e.kind, e.usd);
            j.steps.direct.usd = +(j.steps.direct.usd + e.usd).toFixed(6);
            const sc = scene(j, e.scene);
            if (sc) add(sc.spend, e.kind, e.usd);
          });
        else if (e.type === "log") log({ step: "direct", scene: e.scene, kind: "info", model: MODELS.wonder, message: String(e.message).slice(0, 300) });
        else if (e.type === "budget") {
          stopped = "the life's ceiling stopped Muse Wonder; the remaining films keep their fixed move";
          log({ step: "direct", scene: e.scene, kind: "warn", message: stopped });
        } else if (e.type === "scene") {
          const r = e.report;
          if (r.status === "directed") directed++;
          update((j) => {
            const sc = scene(j, e.scene);
            if (!sc) return;
            sc.wonder = { status: r.status, score: r.score, passed: r.passed, rationale: r.rationale, verdict: r.verdict, rounds: r.rounds, usd: r.usd, note: r.error ?? r.note };
            if (r.status === "directed" && r.video) Object.assign(sc, { video: r.video, poster: r.poster });
          });
          const what = r.status === "directed" ? `directed, critic ${r.score}/10${r.passed ? "" : " (below the pass mark of 8, still better than the fixed move)"}` : r.status === "failed" ? `not directed: ${friendly(r.error)}` : `fixed move kept (${r.note ?? `critic ${r.score}/10`})`;
          log({ step: "direct", scene: e.scene, kind: r.status === "failed" ? "warn" : "info", model: MODELS.wonder, message: what });
        }
      }
    });
    child.stderr.on("data", (d) => log({ step: "direct", kind: "warn", message: String(d).trim().slice(0, 160) }));
    child.on("close", (c) => resolve(c ?? 1));
    child.on("error", () => resolve(1));
  });
  update((j) => {
    for (const sc of j.scenes) if (sc.wonder?.status === "directing") sc.wonder = { status: "kept-fixed-move", note: stopped || "not reached" };
  });
  if (code !== 0) return step("direct", "failed", "Muse Wonder stopped; the films keep their fixed move");
  step("direct", "done", `${directed} of ${todo.length} films directed${stopped ? "; ceiling reached" : ""}`);
}

// ---------- Rehearsal ----------

/** An API error as one readable line: the server's own message when it sent JSON. */
export function friendly(e: unknown): string {
  const raw = String((e as Error)?.message ?? e);
  const m = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const status = raw.match(/^\/\S+ (\d{3}):/)?.[1];
  return (m ? `${status ? `HTTP ${status}: ` : ""}${m[1].replace(/\\"/g, '"').replace(/`/g, "")}` : raw).slice(0, 160);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Replays Jack Sim's finished life as if it were being made: same events, same assets (Muse
 * Wonder's real rationales and critic scores included), timings compressed to about a minute,
 * and costs that add up to the typical cost of a life (lib/cost.ts), so "a real run would cost"
 * matches the figure quoted everywhere else. No Meta calls, nothing written to stories/.
 * One scene is refused and one call retried, so the page's error states can be seen too.
 */
async function runMock() {
  const story = await loadStory("jack-sim");
  const job = state.job!;
  const fake = (stepId: StepId, sceneId: string | undefined, kind: Entry["kind"], usd: number) =>
    update((j) => {
      j.usd = +(j.usd + usd).toFixed(6);
      add(j.spend, kind, usd);
      j.steps[stepId].usd = +(j.steps[stepId].usd + usd).toFixed(6);
      const sc = scene(j, sceneId);
      if (sc) add(sc.spend, kind, usd);
    });
  const say = (stepId: StepId, e: Omit<StageEvent, "stage">) => onStage(stepId)({ stage: "research", ...e });
  // The typical life's costs, spread over the events that would have spent them.
  const cost = lifeCost(ROOT).parts;
  const REFUSED = "s6";
  const painted = story.scenes.filter((s) => s.id !== REFUSED);
  const backgrounds = painted.filter((s) => s.background).length;
  const cutCount = painted.reduce((a, s) => a + s.layers.filter((l) => l.src).length, 0);
  const perBackground = Math.min(PRICES.image, cost.cutouts / Math.max(1, backgrounds));
  const perCut = Math.max(0, cost.cutouts - perBackground * backgrounds) / Math.max(1, cutCount);
  const report = (() => {
    try {
      return JSON.parse(readFileSync(join(ROOT, "public/stories", REHEARSAL.slug, "wonder.json"), "utf8")).scenes as Record<string, { status: string; score?: number; passed?: boolean; rationale?: string; verdict?: string; rounds?: number; note?: string }>;
    } catch {
      return {};
    }
  })();
  const toDirect = painted.filter((s) => s.treatment !== "line" && s.video);

  step("screen", "running");
  say("screen", { kind: "info", model: MODELS.spark, message: `searching the web to confirm who ${job.name} is before any research` });
  await sleep(2500);
  fake("screen", undefined, "spark", cost.screen);
  const checked = story.scenes.flatMap((s) => s.sources).filter((x, i, all) => all.findIndex((y) => y.url === x.url) === i).slice(0, 5);
  update(
    (j) =>
      void (j.screen = {
        ok: true,
        category: "social_enterprise",
        known_for: "founder of the World Toilet Organization",
        check: { status: "identified", singapore: true, minor: false, reason: "Singaporean social entrepreneur who founded the World Toilet Organization in 2001, covered by Wikipedia, the press and the UN.", sources: checked, independent: independentSources(checked) },
      }),
  );
  say("screen", { kind: "info", model: MODELS.spark, message: `founder of the World Toilet Organization: confirmed by ${checked.length} independent sources, go ahead` });
  step("screen", "done", "social enterprise");

  step("research", "running");
  say("research", { kind: "info", model: MODELS.spark, message: `searching the web for ${job.name}` });
  await sleep(2500);
  log({ step: "research", kind: "retry", message: "rate limited; retrying in 3 s" });
  await sleep(2500);
  const facts = story.scenes.map((s, i) => ({ n: i + 1, year: s.year, text: s.caption, sources: s.sources }));
  for (let i = 1; i <= facts.length; i++) {
    update((j) => void (j.facts = facts.slice(0, i)));
    await sleep(350);
  }
  fake("research", undefined, "search", cost.research);
  say("research", { kind: "info", model: MODELS.spark, message: `${facts.length} cited facts` });
  step("research", "done");

  step("storyboard", "running");
  say("storyboard", { kind: "info", model: MODELS.spark, message: `writing 7 scenes from ${facts.length} facts` });
  await sleep(3000);
  fake("storyboard", undefined, "spark", cost.storyboard);
  update((j) => {
    j.tagline = story.tagline;
    j.born = story.born;
    j.died = story.died;
    j.scenes = story.scenes.map((s) => ({ id: s.id, year: s.year, title: s.title, caption: s.caption, treatment: s.treatment, status: "waiting", cuts: [], spend: {} }));
  });
  step("storyboard", "done");

  const front = (async () => {
    step("frontispiece", "running");
    // Jack Sim's frontispiece is traced from a credited Commons photo, not a Muse Image emblem.
    update((j) => void (j.frontispiece = { kind: "photo", credit: "Photo: Clorox Toilet Products, CC BY 2.0, via Wikimedia Commons" }));
    await sleep(4000);
    update((j) => void (j.frontispiece!.image = "/portraits/jack-sim.webp"));
    log({ step: "frontispiece", kind: "asset", message: "credited portrait photo (CC BY 2.0), ready to trace", url: "/portraits/jack-sim.webp" });
    log({ step: "frontispiece", kind: "info", model: MODELS.sam, message: "masking the person, then tracing it in pen lines" });
    await sleep(4000);
    fake("frontispiece", undefined, "sam", cost.frontispiece);
    update((j) => Object.assign(j.frontispiece!, { lines: "/lines/jack-sim.json", strokes: 2400 }));
    log({ step: "frontispiece", kind: "asset", message: "traced in 2400 strokes" });
    step("frontispiece", "done");
  })();

  step("plates", "running");
  const one = async (id: string) => {
    const s = story.scenes.find((x) => x.id === id)!;
    update((j) => void (scene(j, id)!.status = "painting"));
    say("plates", { scene: id, kind: "info", model: MODELS.image, message: `painting ${s.year}` });
    await sleep(3500 + Math.random() * 2500);
    if (id === REFUSED) {
      say("plates", { scene: id, kind: "refused", model: MODELS.image, message: "Muse Image declined this scene under its content policy; skipped" });
      update((j) => Object.assign(scene(j, id)!, { status: "refused", note: "Muse Image declined this scene under its content policy; skipped" }));
      return;
    }
    fake("plates", id, "image", cost.plates / painted.length);
    say("plates", { scene: id, kind: "plate", model: MODELS.image, message: "plate", url: s.plate });
    if (state.job!.steps.cutouts.status === "waiting") step("cutouts", "running");
    update((j) => void (scene(j, id)!.status = "cutting"));
    for (const l of s.layers.filter((x) => x.src)) {
      await sleep(1200);
      fake("cutouts", id, "sam", perCut);
      say("cutouts", { scene: id, kind: "cut", model: MODELS.sam, message: `cut out “${l.concept}”`, url: l.src, data: l });
    }
    if (s.background) {
      await sleep(2500);
      fake("cutouts", id, "image", perBackground);
      say("cutouts", { scene: id, kind: "background", model: MODELS.image, message: "clean background", url: s.background });
    }
    if (s.line) say("cutouts", { scene: id, kind: "line", message: "traced in pen strokes", url: s.line });
    update((j) => void (scene(j, id)!.status = "done"));
  };
  await one("s1");
  await pool(story.scenes.slice(1).map((s) => s.id), PARALLEL, one);
  step("plates", "done", "1 of 7 scenes has no plate");
  step("cutouts", "done");
  await front;

  step("films", "running");
  for (const s of story.scenes.filter((x) => x.video)) {
    await sleep(700);
    update((j) => Object.assign(scene(j, s.id) ?? {}, { poster: s.poster, video: s.video }));
    log({ step: "films", scene: s.id, kind: "info", message: "film rendered" });
  }
  step("films", "done");

  step("direct", "running");
  log({ step: "direct", kind: "info", model: MODELS.wonder, message: `Muse Wonder plans a move for ${toDirect.length} films, watches each one and asks for one revision at most` });
  update((j) => {
    for (const s of toDirect) Object.assign(scene(j, s.id) ?? {}, { wonder: { status: "directing" } });
  });
  let directed = 0;
  await pool(toDirect, DIRECT_PARALLEL, async (s) => {
    const r = report[s.id];
    await sleep(1500 + Math.random() * 1500);
    if (r?.rationale) log({ step: "direct", scene: s.id, kind: "info", model: MODELS.wonder, message: `director: ${r.rationale}` });
    await sleep(1200);
    fake("direct", s.id, "wonder", cost.direct / toDirect.length);
    const ok = r?.status === "directed";
    if (ok) directed++;
    update((j) => Object.assign(scene(j, s.id) ?? {}, { wonder: r ? { status: ok ? "directed" : "kept-fixed-move", score: r.score, passed: r.passed, rationale: r.rationale, verdict: r.verdict, rounds: Math.min(r.rounds ?? 1, DIRECT_ROUNDS + 1), usd: +(cost.direct / toDirect.length).toFixed(4), note: r.note } : { status: "kept-fixed-move", note: "no direction recorded" } }));
    log({ step: "direct", scene: s.id, kind: "info", model: MODELS.wonder, message: r?.score != null ? `${ok ? "directed" : "fixed move kept"}, critic ${r.score}/10` : "fixed move kept" });
  });
  step("direct", "done", `${directed} of ${toDirect.length} films directed`);
}

export { tokenOk };
