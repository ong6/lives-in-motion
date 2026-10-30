/**
 * The family-book runner: a grandparent's recording becomes a private book, made by the same
 * stages as /create with the web research swapped out:
 *
 *   recording → Muse Voice Transcribe (turns with timestamps) → Muse Spark (dated facts, each
 *   quoting the transcript, checked in code) → storyboard (the existing stage, with its
 *   no-politics/war steer) → Muse Image plates → SAM 3.1 cut-outs → frontispiece → films.
 *
 * A family book is a Story with `listed: false` under an unguessable slug: off the shelf, read
 * by link only. Its sources are the moments in the recording, served from this server. Every
 * paid call is tagged `create:<slug>` in the ledger, so family books share /create's daily
 * allowance, and is capped by the same per-life ceiling. State lives on globalThis (it survives
 * hot reloads) and in stories/<slug>/family-job.json (named apart from /create's job.json so
 * neither page mistakes the other's jobs for its own).
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { BudgetError, STOP, entries, spent, withScope, type SpendScope } from "../budget";
import { MODELS, museImage } from "../meta";
import { frontispiece } from "../portrait";
import { emblemPrompt } from "../prompts";
import { ROOT } from "../root";
import { asset, edit, illustrateScene, isRefusal, lineScene, loadStory, pool, segmentScene, storyDir, storyboard, type Emblem, type StageEvent } from "../stages";
import { LIFE_CEILING, LIMITS, createEnabled, dailyCap, jobTag, mockAllowed, mockForced, preflight, slugify, spentToday, validateInput, validatePhoto, type Refusal } from "../create/guard";
import { busy as createBusy, friendly } from "../create";
import { AUDIO_LIMITS, clock, encodeRecording, encodeUpload, sniffAudio } from "./audio";
import { asResearch, extractFacts } from "./facts";
import { applyChecks, checkCaptions } from "./check";
import { SAMPLE } from "./sample";
import { TRANSCRIBE_MODEL, transcribe, type Transcript } from "./transcribe";
import { FAMILY_STEPS, type FamilyFact, type FamilyInfo, type FamilyJob, type FamilyLog, type FamilyScene, type FamilyStepId } from "./types";

/** Typical seconds per step for a 3-minute recording (from the sample's real run). */
export const ESTIMATE: Record<FamilyStepId, number> = { transcribe: 60, facts: 30, storyboard: 25, plates: 160, cutouts: 200, frontispiece: 40, films: 50 };
/** Facts a book needs before it is storyboarded. */
export const MIN_FACTS = 5;
export const MAX_PHOTOS = 3;
const PARALLEL = 3;

interface State {
  job: FamilyJob | null;
  running: boolean;
  listeners: Set<(job: FamilyJob) => void>;
  timer?: ReturnType<typeof setTimeout>;
}
const G = globalThis as unknown as { __limFamily?: State };
const state: State = (G.__limFamily ??= { job: null, running: false, listeners: new Set() });

export const jobFile = (slug: string) => join(storyDir(slug), "family-job.json");
export const familyFile = (slug: string) => join(storyDir(slug), "family.json");
export const recordingFile = (slug: string, ext: "m4a" | "wav") => join(storyDir(slug), `recording.${ext}`);
export const audioUrl = (slug: string) => `/api/family/${slug}/audio`;
const SLUG = /^[a-z0-9-]{1,80}$/;

/** What stories/<slug>/family.json keeps beside the book. */
export interface FamilyRecord {
  slug: string;
  name: string;
  hint: string;
  sample?: boolean;
  label?: string;
  createdAt: string;
  origin: string;
  /** sha256 of the delete key, which only the maker's browser holds. Absent on the sample. */
  keyHash?: string;
  durationMs?: number;
  transcript?: Transcript;
  subject?: string;
  facts?: FamilyFact[];
  dropped?: { text: string; why: string }[];
  photos: number;
}

export function readRecord(slug: string): FamilyRecord | null {
  if (!SLUG.test(slug) || !existsSync(familyFile(slug))) return null;
  try {
    return JSON.parse(readFileSync(familyFile(slug), "utf8")) as FamilyRecord;
  } catch {
    return null;
  }
}
const writeRecord = async (r: FamilyRecord) => {
  const f = familyFile(r.slug);
  await writeFile(`${f}.tmp`, JSON.stringify(r, null, 1));
  await rename(`${f}.tmp`, f);
};

// ---------- Reading ----------

export function budgetNow() {
  const all = entries();
  const total = spent();
  return { spent: total, stop: STOP, left: STOP - total, today: spentToday(all), dailyCap: dailyCap() };
}

export function sampleInfo(): FamilyInfo["sample"] {
  const r = readRecord(SAMPLE.slug);
  if (!r || !existsSync(join(storyDir(SAMPLE.slug), "story.json"))) return undefined;
  const job = readJob(SAMPLE.slug);
  let plates: { year: string; title: string; src: string }[] = [];
  try {
    const story = JSON.parse(readFileSync(join(storyDir(SAMPLE.slug), "story.json"), "utf8"));
    plates = story.scenes.filter((s: { plate?: string }) => s.plate).map((s: { year: string; title: string; plate: string }) => ({ year: s.year, title: s.title, src: s.plate }));
  } catch {}
  return {
    slug: SAMPLE.slug,
    name: r.name,
    label: SAMPLE.label,
    audio: audioUrl(SAMPLE.slug),
    download: "/family/ah-ma-sample.wav",
    seconds: Math.round((r.durationMs ?? 0) / 1000),
    usd: job?.usd,
    took: job?.finishedAt ? Math.round((Date.parse(job.finishedAt) - Date.parse(job.startedAt)) / 1000) : undefined,
    plates,
  };
}

export function info(): FamilyInfo {
  const env = process.env;
  return {
    enabled: createEnabled(env),
    reason: createEnabled(env) ? undefined : "Making family books is switched off on this server.",
    needsToken: Boolean(env.CREATE_TOKEN),
    mockAllowed: mockAllowed(env),
    budget: budgetNow(),
    ceiling: LIFE_CEILING,
    estimate: ESTIMATE,
    limits: { seconds: AUDIO_LIMITS.seconds, uploadMb: AUDIO_LIMITS.uploadBytes / 1024 / 1024, photos: MAX_PHOTOS, photoMb: LIMITS.photoBytes / 1024 / 1024 },
    sample: sampleInfo(),
    job: state.job,
  };
}

function readJob(slug: string): FamilyJob | null {
  if (!SLUG.test(slug)) return null;
  const f = jobFile(slug);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as FamilyJob;
  } catch {
    return null;
  }
}

/** The job for a slug: the live one, else its saved file (a "running" file with no runner was interrupted). */
export function getJob(slug: string): FamilyJob | null {
  if (state.job?.slug === slug) return state.job;
  const job = readJob(slug);
  if (job?.status === "running") job.status = "interrupted";
  return job;
}

export const busy = () => (state.running ? (state.job?.slug ?? "a family book") : null);

export function subscribe(fn: (job: FamilyJob) => void): () => void {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

// ---------- Writing the live job ----------

function persist(job: FamilyJob) {
  if (job.mock) return;
  const f = jobFile(job.slug);
  const tmp = `${f}.tmp`;
  mkdir(storyDir(job.slug), { recursive: true })
    .then(() => writeFile(tmp, JSON.stringify(job, null, 1)))
    .then(() => rename(tmp, f))
    .catch(() => {});
}

function update(fn: (job: FamilyJob) => void, flush = false) {
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

const log = (entry: Omit<FamilyLog, "at">) => update((j) => j.log.push({ at: new Date().toISOString(), ...entry }));

function step(id: FamilyStepId, status: FamilyJob["steps"][FamilyStepId]["status"], note?: string) {
  update((j) => {
    const s = j.steps[id];
    if (s.status === "done" && (status === "running" || status === "done")) return;
    if (status === "running") s.startedAt ??= new Date().toISOString();
    else if (status !== "waiting") s.endedAt = new Date().toISOString();
    s.status = status;
    if (note) s.note = note;
  });
}

const sceneOf = (j: FamilyJob, id?: string) => j.scenes.find((s) => s.id === id);
const add = (spend: Record<string, number>, kind: string, usd: number) => (spend[kind] = +((spend[kind] ?? 0) + usd).toFixed(6));

const scoped = <T>(stepId: FamilyStepId, sceneId: string | undefined, fn: () => Promise<T>) =>
  withScope(
    {
      onSpend: (e) =>
        update((j) => {
          j.steps[stepId].usd = +(j.steps[stepId].usd + e.usd).toFixed(6);
          const sc = sceneOf(j, sceneId);
          if (sc) add(sc.spend as Record<string, number>, e.kind, e.usd);
        }),
      onRetry: (message) => log({ step: stepId, scene: sceneId, kind: "retry", message }),
    },
    fn,
  );

function onStage(stepId: FamilyStepId) {
  return (e: StageEvent) =>
    update((j) => {
      const sc = sceneOf(j, e.scene);
      if (e.kind === "plate" && sc) Object.assign(sc, { plate: e.url, status: sc.status === "waiting" || sc.status === "painting" ? "painted" : sc.status });
      if (e.kind === "refused" && sc && e.stage === "illustrate") Object.assign(sc, { status: "refused", note: e.message });
      if (e.kind === "cut" && sc) {
        const d = e.data as FamilyScene["cuts"][number];
        sc.cuts.push({ concept: d.concept, src: d.src, x: d.x, y: d.y, w: d.w });
      }
      if (e.kind === "background" && sc) sc.background = e.url;
      if (e.kind === "line" && sc) sc.line = e.url;
      const kind: FamilyLog["kind"] = e.kind === "refused" ? "refused" : e.kind === "warn" || e.kind === "error" ? e.kind : e.url ? "asset" : "info";
      j.log.push({ at: new Date().toISOString(), step: stepId, scene: e.scene, kind, message: e.message, model: e.model, url: e.url });
    });
}

export function newJob(o: { slug: string; name: string; hint: string; photos: number; mock?: boolean; sample?: boolean; bookSlug?: string }): FamilyJob {
  const now = new Date().toISOString();
  return {
    slug: o.slug,
    name: o.name,
    hint: o.hint,
    photos: o.photos,
    mock: o.mock,
    sample: o.sample,
    bookSlug: o.bookSlug ?? o.slug,
    status: "running",
    startedAt: now,
    updatedAt: now,
    steps: Object.fromEntries(FAMILY_STEPS.map((s) => [s, { status: "waiting", usd: 0 }])) as FamilyJob["steps"],
    turns: [],
    facts: [],
    scenes: [],
    usd: 0,
    ceiling: LIFE_CEILING,
    spend: {},
    models: { transcribe: TRANSCRIBE_MODEL, spark: MODELS.spark, image: MODELS.image, sam: MODELS.sam },
    log: [],
  };
}

// ---------- Starting ----------

export interface StartRequest {
  name: unknown;
  hint: unknown;
  /** Names and places to listen for, comma-separated (vocabulary biasing). */
  keywords?: unknown;
  audio?: { size: number; bytes: Uint8Array } | null;
  photos?: { type: string; size: number; bytes: Uint8Array }[];
  token?: string | null;
  mock?: boolean;
  /** The site's origin as the visitor reached it; citation links point here, where the recording is. */
  origin: string;
}

export type StartResult = { ok: true; slug: string; key?: string } | ({ ok: false } & Refusal);

/** A family book's slug: the name plus a random tail, so an unlisted book can't be guessed. */
export function familySlug(name: string, taken: (slug: string) => boolean): string {
  const base = (slugify(name) || "family").slice(0, 40).replace(/-+$/, "");
  for (;;) {
    const s = `${base}-${randomBytes(5).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6).padEnd(6, "x")}`;
    if (!taken(s)) return s;
  }
}

const taken = (s: string) => existsSync(storyDir(s)) || existsSync(join(ROOT, "public/stories", s)) || existsSync(join(ROOT, "public/lines", `${s}.json`));
export const keyHash = (key: string) => createHash("sha256").update(key).digest("hex");
export const cleanKeywords = (v: unknown) =>
  (typeof v === "string" ? v : "")
    .split(/[,\n]/)
    .map((k) => k.replace(/[<>{}\\`]/g, "").trim())
    .filter((k) => k.length > 1 && k.length <= 40)
    .slice(0, 30);

export async function start(req: StartRequest): Promise<StartResult> {
  const mock = Boolean(req.mock) || mockForced();
  const refused = preflight({ entries: entries(), left: STOP - spent(), busy: busy() ?? (mock ? null : createBusy()), token: req.token, mock });
  if (refused) return { ok: false, ...refused };

  if (mock) {
    const sample = readJob(SAMPLE.slug);
    if (!sample || sample.status !== "done") return { ok: false, status: 404, error: "The sample book hasn't been made on this server yet." };
    const slug = `sample-replay-${Date.now().toString(36)}`;
    launch(newJob({ slug, name: sample.name, hint: sample.hint, photos: 0, mock: true, sample: true, bookSlug: SAMPLE.slug }), () => runMock(sample));
    return { ok: true, slug };
  }

  const v = validateInput(req.name, req.hint);
  if (!v.ok) return { ok: false, status: 400, error: v.error.replace("the person's name", "their name, as the family says it") };
  const audio = req.audio;
  if (!audio || !audio.size) return { ok: false, status: 400, error: "Record or choose a recording first." };
  if (audio.size > AUDIO_LIMITS.uploadBytes) return { ok: false, status: 400, error: `The recording is over ${AUDIO_LIMITS.uploadBytes / 1024 / 1024} MB; trim it to ten minutes or less.` };
  if (!sniffAudio(audio.bytes)) return { ok: false, status: 400, error: "That file isn't a recording we can read. Use WAV, MP3, M4A, WebM, Ogg or FLAC." };
  const photos = (req.photos ?? []).filter((p) => p.size > 0);
  if (photos.length > MAX_PHOTOS) return { ok: false, status: 400, error: `Up to ${MAX_PHOTOS} photos, please.` };
  for (const p of photos) {
    const ok = validatePhoto(p);
    if (!ok.ok) return { ok: false, status: 400, error: ok.error };
  }

  const slug = familySlug(v.value.name, taken);
  const key = randomBytes(18).toString("base64url");
  const job = newJob({ slug, name: v.value.name, hint: v.value.hint, photos: photos.length });
  launch(job, () =>
    runReal({ slug, name: v.value.name, hint: v.value.hint, keywords: cleanKeywords(req.keywords), origin: req.origin, keyHash: keyHash(key), audio: { bytes: audio.bytes }, photos: photos.map((p) => p.bytes) }),
  );
  return { ok: true, slug, key };
}

/** Run a job in this process; resolves when it has finished (the routes don't wait, the CLI does). */
export function launch(job: FamilyJob, run: () => Promise<void>): Promise<void> {
  state.job = job;
  state.running = true;
  update(() => {}, true);
  return (async () => {
    try {
      await run();
      update((j) => {
        j.status = "done";
        j.finishedAt = new Date().toISOString();
      }, true);
    } catch (e) {
      const budgetStop = e instanceof BudgetError;
      update((j) => {
        j.status = "failed";
        j.finishedAt = new Date().toISOString();
        j.error = budgetStop ? String((e as Error).message).replace(/^budget: /, "Budget guard: ") : friendly(e);
        const at = FAMILY_STEPS.find((id) => j.steps[id].status === "running") ?? "transcribe";
        for (const s of Object.values(j.steps)) if (s.status === "running") s.status = "failed";
        j.log.push({ at: new Date().toISOString(), step: at, kind: "error", message: j.error });
      }, true);
    } finally {
      state.running = false;
      update(() => {}, true);
    }
  })();
}

// ---------- The real run ----------

export interface RealInput {
  slug: string;
  name: string;
  hint: string;
  keywords: string[];
  origin: string;
  keyHash?: string;
  /** Raw upload bytes, or a file already on disk (the CLI). */
  audio: { bytes?: Uint8Array; file?: string };
  photos: Uint8Array[];
  sample?: boolean;
}

const storyHint = (hint: string) => `${hint ? `${hint}; ` : ""}a private family history told in their own words in a family recording, not a public figure`;

export async function runReal(input: RealInput) {
  const { slug } = input;
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
    const dir = storyDir(slug);
    await mkdir(join(dir, "source"), { recursive: true });
    const prefix = input.sample ? "Fictional sample recording" : "Recording";
    let record: FamilyRecord = readRecord(slug) ?? {
      slug,
      name: input.name,
      hint: input.hint,
      createdAt: new Date().toISOString(),
      origin: input.origin,
      photos: input.photos.length,
      ...(input.sample ? { sample: true, label: SAMPLE.label } : {}),
      ...(input.keyHash ? { keyHash: input.keyHash } : {}),
    };

    // 1. The recording, re-encoded (metadata dropped) into the API's WAV and a browser M4A.
    step("transcribe", "running");
    if (!existsSync(recordingFile(slug, "wav"))) {
      log({ step: "transcribe", kind: "info", message: "re-encoding the recording on this server (ffmpeg; metadata removed)" });
      const enc = input.audio.file ? await encodeRecording(input.audio.file, dir) : await encodeUpload(input.audio.bytes!, dir);
      if (enc.seconds > AUDIO_LIMITS.seconds) throw new Error(`The recording runs over ${AUDIO_LIMITS.seconds / 60} minutes, the most Muse Voice Transcribe takes in one go. Trim it and try again.`);
      if (enc.seconds < AUDIO_LIMITS.minSeconds) throw new Error("The recording is only a few seconds long; there's nothing to make a book from.");
      record.durationMs = Math.round(enc.seconds * 1000);
    }
    for (const [i, bytes] of input.photos.entries()) {
      // Re-encoded, which also drops EXIF (camera, GPS) from the family's file.
      await sharp(Buffer.from(bytes)).rotate().resize(2000, 2000, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toFile(join(dir, `source/photo-${i + 1}.jpg`));
    }
    await writeRecord(record);
    update((j) => Object.assign(j, { audio: audioUrl(slug), durationMs: record.durationMs }));

    // 2. Muse Voice Transcribe: turns with start times and speaker labels.
    let t = record.transcript;
    if (!t) {
      log({ step: "transcribe", kind: "info", model: TRANSCRIBE_MODEL, message: `transcribing ${clock((record.durationMs ?? 0) / 1000)} of audio (English, Malay, Mandarin, Tamil; speakers labelled)` });
      const started = Date.now();
      t = await scoped("transcribe", undefined, () => transcribe(recordingFile(slug, "wav"), { keywords: input.keywords, note: `family: ${slug}` }));
      record = { ...record, transcript: t, durationMs: t.durationMs || record.durationMs };
      await writeRecord(record);
      log({ step: "transcribe", kind: "info", model: TRANSCRIBE_MODEL, message: `${t.turns.length} turns${t.untimed ? " (no timestamps came back; citing transcript lines)" : ""} in ${Math.round((Date.now() - started) / 1000)} s` });
    }
    update((j) => void (j.turns = t!.turns));
    step("transcribe", "done", t.untimed ? "no timestamps returned; facts cite transcript lines" : undefined);

    // 3. Muse Spark: dated facts, each quoting the transcript; code checks every quote.
    step("facts", "running");
    if (!record.facts) {
      log({ step: "facts", kind: "info", model: MODELS.spark, message: `reading ${t.turns.length} turns for dated facts` });
      const r = await scoped("facts", undefined, () => extractFacts(input.name, input.hint, t!.turns, { origin: record.origin, slug, prefix }));
      record = { ...record, facts: r.facts, dropped: r.dropped, subject: r.subject };
      await writeRecord(record);
      for (const d of r.dropped) log({ step: "facts", kind: "warn", message: `left out “${d.text.slice(0, 80)}”: ${d.why}` });
    }
    const facts = record.facts!;
    update((j) => Object.assign(j, { facts, subject: record.subject }));
    log({ step: "facts", kind: "info", model: MODELS.spark, message: `${facts.length} dated facts, each cited to the second it was said${facts.some((f) => f.approx) ? `; ${facts.filter((f) => f.approx).length} with estimated years` : ""}` });
    if (facts.length < MIN_FACTS)
      throw new Error(`The recording gave ${facts.length} dated facts; a book needs at least ${MIN_FACTS}. A longer recording with years or ages (“in 1966 we moved…”, “when I was fourteen…”) will work.`);
    await writeFile(join(dir, "research.json"), JSON.stringify(asResearch(input.name, storyHint(input.hint), facts), null, 2));
    step("facts", "done");

    // 4. The storyboard stage, unchanged: seven scenes, sources copied from the facts.
    step("storyboard", "running");
    if (!existsSync(join(dir, "story.json"))) {
      await scoped("storyboard", undefined, () => storyboard(slug, onStage("storyboard"), { listed: false }));
      // A family book is never on the shelf, and the sample says what it is on its title page.
      await edit(slug, (s) => {
        s.listed = false;
        if (input.sample && !s.tagline.startsWith(SAMPLE.label)) s.tagline = `${SAMPLE.label}. ${s.tagline}`;
      });
    }
    // Every caption checked against the recording; anything nobody said is rewritten out.
    if ((await loadStory(slug)).scenes.some((s) => !s.checked)) {
      log({ step: "storyboard", kind: "info", model: MODELS.spark, message: "checking every caption against the recording" });
      const before = await loadStory(slug);
      const verdicts = await scoped("storyboard", undefined, () => checkCaptions(before, facts, t!.turns));
      let fixed = 0;
      await edit(slug, (s) => void (fixed = applyChecks(s, verdicts)));
      log({ step: "storyboard", kind: "info", model: MODELS.spark, message: fixed ? `${fixed} caption${fixed > 1 ? "s" : ""} rewritten to say only what was said` : "every caption is supported by the recording" });
    }
    const story = await loadStory(slug);
    update((j) => {
      j.tagline = story.tagline;
      j.born = story.born;
      const old = new Map(j.scenes.map((s) => [s.id, s]));
      j.scenes = story.scenes.map((s) => ({
        id: s.id,
        year: s.year,
        title: s.title,
        caption: s.caption,
        treatment: s.treatment,
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
    await writeFile(join(dir, "credit.json"), JSON.stringify(creditFor(state.job!, input.sample), null, 2) + "\n");
  });
}

export function creditFor(job: Pick<FamilyJob, "frontispiece">, sample?: boolean) {
  const lead = sample ? `${SAMPLE.label}; nobody in this book is real. ` : "";
  return job.frontispiece?.kind === "photo"
    ? { kind: "reader-photo", text: `${lead}Traced from a family photo, shared with the family's consent; no face was generated.`, masked: "SAM 3.1" }
    : { kind: "emblem", text: `${lead}Frontispiece: an emblem of the life painted by Muse Image, cut out with SAM 3.1 and traced in pen lines. Not a likeness.`, masked: "SAM 3.1" };
}

function limiter(n: number) {
  let live = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
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

/** Plates (plate 1 first, the style reference), then cut-outs and line drawings per scene. Same shape as /create. */
async function scenesRun(slug: string) {
  const ids = state.job!.scenes.map((s) => s.id);
  step("plates", "running");
  const setStatus = (id: string, status: FamilyScene["status"], note?: string) =>
    update((j) => {
      const sc = sceneOf(j, id);
      if (sc && sc.status !== "refused") Object.assign(sc, { status }, note ? { note } : {});
    });
  const paint = async (id: string) => {
    setStatus(id, "painting");
    try {
      const ok = await scoped("plates", id, () => illustrateScene(slug, id, onStage("plates")));
      if (ok) setStatus(id, "painted");
      return ok;
    } catch (e) {
      if (e instanceof BudgetError) throw e;
      setStatus(id, "failed", `Muse Image failed: ${friendly(e)}`);
      log({ step: "plates", scene: id, kind: "error", message: `plate failed: ${friendly(e)}` });
      return false;
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
  const finishing: Promise<void>[] = [];
  const lane = limiter(PARALLEL);
  const painted = async (id: string) => {
    if (sceneOf(state.job!, id)!.status === "done") return;
    if (await paint(id)) finishing.push(lane(() => finish(id)));
  };
  const [first, ...rest] = ids;
  await painted(first);
  await pool(rest, PARALLEL, painted);
  const refused = state.job!.scenes.filter((s) => s.status === "refused" || s.status === "failed").length;
  step("plates", refused === ids.length ? "failed" : "done", refused ? `${refused} of ${ids.length} scenes have no plate` : undefined);
  await Promise.all(finishing);
  step("cutouts", state.job!.steps.cutouts.status === "waiting" ? "skipped" : "done");
}

/**
 * The frontispiece: a family photo (SAM 3.1 finds the person; the first photo it finds one in is
 * traced) or, without one, a Muse Image emblem. Photos are only ever traced, never sent to an
 * image generator, so no face is made up.
 */
async function frontRun(slug: string) {
  const job = state.job!;
  const dir = storyDir(slug);
  step("frontispiece", "running");
  try {
    await scoped("frontispiece", undefined, async () => {
      const photos = Array.from({ length: job.photos }, (_, i) => join(dir, `source/photo-${i + 1}.jpg`)).filter((f) => existsSync(f));
      for (const file of photos) {
        update((j) => void (j.frontispiece = { kind: "photo" }));
        const shown = asset(slug, "frontispiece", "source.webp");
        await mkdir(join(shown.file, ".."), { recursive: true });
        await sharp(file).resize(700, 900, { fit: "inside" }).greyscale().webp({ quality: 80 }).toFile(shown.file);
        update((j) => void (j.frontispiece!.image = shown.url));
        log({ step: "frontispiece", kind: "info", model: MODELS.sam, message: "masking the person in the family photo, then tracing it in pen lines" });
        const p = await frontispiece(slug, file, "person", { kind: "reader-photo", license: "Supplied by the reader (a family photo, with consent)", artist: "the family" });
        if (p.credit.masked === "none" && file !== photos.at(-1)) {
          log({ step: "frontispiece", kind: "warn", model: MODELS.sam, message: "SAM 3.1 found no person in that photo; trying the next" });
          continue;
        }
        update((j) => Object.assign(j.frontispiece!, { lines: `/lines/${slug}.json`, strokes: p.strokes.length }));
        log({ step: "frontispiece", kind: "asset", message: `traced in ${p.strokes.length} strokes`, url: p.photo });
        return;
      }
      update((j) => void (j.frontispiece = { kind: "emblem" }));
      const emblem: Emblem = existsSync(join(dir, "emblem.json"))
        ? JSON.parse(await readFile(join(dir, "emblem.json"), "utf8"))
        : { visual: `a treasured household object that stands for the life of ${job.name}`, concept: "object" };
      const concept = emblem.concept.split(/\s+/).slice(-2).join(" ") || "object";
      const file = join(dir, "source/emblem.png");
      if (!existsSync(file)) {
        log({ step: "frontispiece", kind: "info", model: MODELS.image, message: `painting an emblem: ${emblem.concept}` });
        await writeFile(file, await museImage(emblemPrompt(emblem.visual, emblem.concept), []));
      }
      const shown = asset(slug, "frontispiece", "source.webp");
      await mkdir(join(shown.file, ".."), { recursive: true });
      await sharp(file).resize(700, 900, { fit: "inside" }).webp({ quality: 80 }).toFile(shown.file);
      update((j) => void (j.frontispiece!.image = shown.url));
      log({ step: "frontispiece", kind: "asset", model: MODELS.image, message: "emblem", url: shown.url });
      log({ step: "frontispiece", kind: "info", model: MODELS.sam, message: `masking the ${concept}, then tracing it in pen lines` });
      const p = await frontispiece(slug, file, concept, { kind: "emblem", license: "Generated with Muse Image", artist: "Muse Image" });
      update((j) => Object.assign(j.frontispiece!, { lines: `/lines/${slug}.json`, strokes: p.strokes.length }));
      log({ step: "frontispiece", kind: "asset", message: `traced in ${p.strokes.length} strokes` });
    });
    step("frontispiece", "done");
  } catch (e) {
    if (e instanceof BudgetError) throw e;
    const msg = isRefusal(e) ? "Muse Image declined the emblem; the book opens without a frontispiece" : `no frontispiece: ${friendly(e)}`;
    update((j) => void (j.frontispiece = { ...(j.frontispiece ?? { kind: "emblem" }), note: msg }));
    log({ step: "frontispiece", kind: isRefusal(e) ? "refused" : "error", message: msg });
    step("frontispiece", "failed", msg);
  }
}

/** Scroll films, rendered locally by pnpm video in a child process (no API calls). */
async function filmsRun(slug: string) {
  if (!state.job!.scenes.some((s) => s.plate && s.treatment !== "line")) return step("films", "skipped", "no plates to film");
  step("films", "running");
  log({ step: "films", kind: "info", message: "rendering scroll films on this machine (sharp + ffmpeg, no API calls)" });
  const code = await new Promise<number>((resolve) => {
    const child = spawn(join(ROOT, "node_modules/.bin/tsx"), ["pipeline/video.ts", slug], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: process.env });
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
    for (const s of story.scenes) Object.assign(sceneOf(j, s.id) ?? {}, { video: s.video, poster: s.poster });
  });
  step("films", code === 0 ? "done" : "failed", code === 0 ? undefined : "the film renderer stopped; the book shows still plates instead");
}

// ---------- Deleting ----------

/** Everything a family book wrote: its folder (recording, transcript, story) and its public assets. */
export const bookPaths = (slug: string) => [storyDir(slug), join(ROOT, "public/stories", slug), join(ROOT, "public/lines", `${slug}.json`), join(ROOT, "public/portraits", `${slug}.webp`)];

export function keyOk(given: string | null | undefined, hash: string | undefined): boolean {
  if (!given || !hash) return false;
  const a = Buffer.from(keyHash(given)), b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Delete a family book and its recording. Needs the book's delete key; the sample can't be deleted from the web. */
export async function deleteBook(slug: string, key: string | null | undefined): Promise<{ ok: true } | ({ ok: false } & Refusal)> {
  const r = readRecord(slug);
  if (!r) return { ok: false, status: 404, error: "There is no family book by that name." };
  if (r.sample) return { ok: false, status: 403, error: "The sample book stays; it is the demo." };
  if (!keyOk(key, r.keyHash)) return { ok: false, status: 403, error: "Only the browser that made this book (or its private delete link) can delete it." };
  if (state.running && state.job?.slug === slug) return { ok: false, status: 409, error: "This book is still being made; delete it once it finishes." };
  for (const p of bookPaths(slug)) await rm(p, { recursive: true, force: true });
  if (state.job?.slug === slug) state.job = null;
  return { ok: true };
}

// ---------- Replaying the sample ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Replays the sample book's real run, compressed to about a minute: the same turns, facts,
 * plates and costs, from its saved job. No Meta calls, nothing written, nothing charged.
 */
async function runMock(rec: FamilyJob) {
  const fake = (stepId: FamilyStepId, sceneId: string | undefined, kind: string, usd: number) =>
    update((j) => {
      j.usd = +(j.usd + usd).toFixed(6);
      add(j.spend, kind, usd);
      j.steps[stepId].usd = +(j.steps[stepId].usd + usd).toFixed(6);
      const sc = sceneOf(j, sceneId);
      if (sc) add(sc.spend as Record<string, number>, kind, usd);
    });
  const say = (stepId: FamilyStepId, e: Omit<StageEvent, "stage">) => onStage(stepId)({ stage: "research", ...e });
  const story = await loadStory(SAMPLE.slug);
  // The real run's step costs, shared out over the scenes that had them.
  const painted = Math.max(1, story.scenes.filter((s) => s.plate).length);
  const perPlate = rec.steps.plates.usd / painted, perCut = rec.steps.cutouts.usd / painted;

  step("transcribe", "running");
  update((j) => Object.assign(j, { audio: rec.audio, durationMs: rec.durationMs }));
  log({ step: "transcribe", kind: "info", model: TRANSCRIBE_MODEL, message: `transcribing ${clock((rec.durationMs ?? 0) / 1000)} of audio (English, Malay, Mandarin, Tamil; speakers labelled)` });
  await sleep(2500);
  for (let i = 1; i <= rec.turns.length; i++) {
    update((j) => Object.assign(j, { turns: rec.turns.slice(0, i), subject: rec.subject }));
    await sleep(Math.min(900, 9000 / rec.turns.length));
  }
  fake("transcribe", undefined, "transcribe", rec.steps.transcribe.usd);
  log({ step: "transcribe", kind: "info", model: TRANSCRIBE_MODEL, message: `${rec.turns.length} turns` });
  step("transcribe", "done");

  step("facts", "running");
  log({ step: "facts", kind: "info", model: MODELS.spark, message: `reading ${rec.turns.length} turns for dated facts` });
  await sleep(2500);
  for (let i = 1; i <= rec.facts.length; i++) {
    update((j) => void (j.facts = rec.facts.slice(0, i)));
    await sleep(450);
  }
  fake("facts", undefined, "spark", rec.steps.facts.usd);
  log({ step: "facts", kind: "info", model: MODELS.spark, message: `${rec.facts.length} dated facts, each cited to the second it was said` });
  step("facts", "done");

  step("storyboard", "running");
  log({ step: "storyboard", kind: "info", model: MODELS.spark, message: `writing 7 scenes from ${rec.facts.length} facts` });
  await sleep(2500);
  fake("storyboard", undefined, "spark", rec.steps.storyboard.usd);
  update((j) => {
    Object.assign(j, { tagline: story.tagline, born: story.born });
    j.scenes = story.scenes.map((s) => ({ id: s.id, year: s.year, title: s.title, caption: s.caption, treatment: s.treatment, status: "waiting", cuts: [], spend: {} }));
  });
  step("storyboard", "done");

  const front = (async () => {
    step("frontispiece", "running");
    update((j) => void (j.frontispiece = { kind: rec.frontispiece?.kind ?? "emblem" }));
    await sleep(4000);
    update((j) => void (j.frontispiece!.image = rec.frontispiece?.image));
    log({ step: "frontispiece", kind: "asset", model: MODELS.image, message: "emblem", url: rec.frontispiece?.image });
    await sleep(3500);
    fake("frontispiece", undefined, "image", rec.steps.frontispiece.usd);
    update((j) => Object.assign(j.frontispiece!, { lines: rec.frontispiece?.lines, strokes: rec.frontispiece?.strokes }));
    log({ step: "frontispiece", kind: "asset", message: `traced in ${rec.frontispiece?.strokes ?? 0} strokes` });
    step("frontispiece", "done");
  })();

  step("plates", "running");
  const one = async (id: string) => {
    const s = story.scenes.find((x) => x.id === id)!;
    update((j) => void (sceneOf(j, id)!.status = "painting"));
    say("plates", { scene: id, kind: "info", model: MODELS.image, message: `painting ${s.year}` });
    await sleep(3000 + Math.random() * 2000);
    if (!s.plate) {
      say("plates", { scene: id, kind: "refused", model: MODELS.image, message: "Muse Image declined this scene under its content policy; skipped" });
      return;
    }
    fake("plates", id, "image", perPlate);
    say("plates", { scene: id, kind: "plate", model: MODELS.image, message: "plate", url: s.plate });
    if (state.job!.steps.cutouts.status === "waiting") step("cutouts", "running");
    update((j) => void (sceneOf(j, id)!.status = "cutting"));
    for (const l of s.layers.filter((x) => x.src)) {
      await sleep(1000);
      say("cutouts", { scene: id, kind: "cut", model: MODELS.sam, message: `cut out “${l.concept}”`, url: l.src, data: l });
    }
    fake("cutouts", id, "sam", perCut);
    if (s.background) {
      await sleep(2000);
      say("cutouts", { scene: id, kind: "background", model: MODELS.image, message: "clean background", url: s.background });
    }
    if (s.line) say("cutouts", { scene: id, kind: "line", message: "traced in pen strokes", url: s.line });
    update((j) => void (sceneOf(j, id)!.status = "done"));
  };
  await one(story.scenes[0].id);
  await pool(story.scenes.slice(1).map((s) => s.id), PARALLEL, one);
  step("plates", "done", rec.steps.plates.note);
  step("cutouts", "done");
  await front;

  step("films", "running");
  for (const s of story.scenes.filter((x) => x.video)) {
    await sleep(600);
    update((j) => Object.assign(sceneOf(j, s.id) ?? {}, { poster: s.poster, video: s.video }));
    log({ step: "films", scene: s.id, kind: "info", message: "film rendered" });
  }
  step("films", "done");
}

export { SAMPLE };
