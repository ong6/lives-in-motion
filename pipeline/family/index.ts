/**
 * The /family runner: a grandparent's recording becomes a private book, made by the same stages
 * and runner as /create (pipeline/jobs/) with the web research swapped out:
 *
 *   recording → Muse Voice Transcribe (turns with timestamps) → Muse Spark (dated facts, each
 *   quoting the transcript, checked in code) → storyboard (the existing stage, with its
 *   no-politics/war steer) and a caption check against the recording → Muse Image plates →
 *   SAM 3.1 cut-outs → frontispiece → films.
 *
 * A family book is a Story with `listed: false` under an unguessable slug: off the shelf, read
 * by link only. Its sources are the moments in the recording, served from this server
 * (`/family/<slug>/audio#t=<s>`), which is how the site tells a family book apart. Every paid
 * call is tagged `create:<slug>` in the ledger, so family books share /create's daily allowance
 * and per-book ceiling.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { BudgetError, STOP, entries, spent, withScope } from "../budget";
import { MODELS } from "../meta";
import { frontispiece } from "../portrait";
import { edit, isRefusal, loadStory, storyDir, storyboard } from "../stages";
import { LIFE_CEILING, LIMITS, mockForced, preflight, rails, validateInput, validatePhoto, type Refusal } from "../jobs/guard";
import { createRunner, friendly } from "../jobs/runner";
import { emblemSource, jobScenes, reencodePhoto, runFilms, runScenes, showSource, slugTaken, writeCredit } from "../jobs/steps";
import { busy as createBusy } from "../create";
import { AUDIO_LIMITS, clock, encodeRecording, encodeUpload, sniffAudio } from "./audio";
import { applyChecks, checkCaptions } from "./check";
import { asResearch, extractFacts } from "./facts";
import { audioUrl, bookPaths, cleanKeywords, familySlug, jobFile, keyHash, keyOk, newKey, readRecord, recordingFile, writeRecord, type FamilyRecord } from "./record";
import { replay } from "./replay";
import { SAMPLE } from "./sample";
import { transcribe } from "./transcribe";
import { FAMILY_STEPS, type FamilyInfo, type FamilyJob, type FamilyStepId } from "./types";

/** Typical seconds per step for a 3-minute recording (from the sample's real run). */
export const ESTIMATE: Record<FamilyStepId, number> = { transcribe: 60, facts: 30, storyboard: 25, plates: 160, cutouts: 200, frontispiece: 40, films: 50 };
/** Facts a book needs before it is storyboarded. */
const MIN_FACTS = 5;
const MAX_PHOTOS = 3;

export const runner = createRunner<FamilyStepId, FamilyJob>({
  key: "__limFamily",
  file: jobFile,
  label: "a family book",
  failedAt: (j) => FAMILY_STEPS.find((id) => j.steps[id].status === "running") ?? "transcribe",
});
const { getJob, busy, subscribe, update, log, step, scoped, onStage, launch } = runner;
export { getJob, subscribe, launch };

// ---------- Reading ----------

function sampleInfo(): FamilyInfo["sample"] {
  const r = readRecord(SAMPLE.slug);
  if (!r || !existsSync(join(storyDir(SAMPLE.slug), "story.json"))) return undefined;
  const job = runner.readJob(SAMPLE.slug);
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
  return {
    ...rails("Making family books is switched off on this server."),
    estimate: ESTIMATE,
    limits: { seconds: AUDIO_LIMITS.seconds, uploadMb: AUDIO_LIMITS.uploadBytes / 1024 / 1024, photos: MAX_PHOTOS, photoMb: LIMITS.photoBytes / 1024 / 1024 },
    sample: sampleInfo(),
    job: runner.state.job,
  };
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
    models: { transcribe: MODELS.transcribe, spark: MODELS.spark, image: MODELS.image, sam: MODELS.sam },
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

export async function start(req: StartRequest): Promise<{ ok: true; slug: string; key?: string } | ({ ok: false } & Refusal)> {
  const mock = Boolean(req.mock) || mockForced();
  const refused = preflight({ entries: entries(), left: STOP - spent(), busy: busy() ?? (mock ? null : createBusy()), token: req.token, mock });
  if (refused) return { ok: false, ...refused };

  if (mock) {
    const sample = runner.readJob(SAMPLE.slug);
    if (!sample || sample.status !== "done") return { ok: false, status: 404, error: "The sample book hasn't been made on this server yet." };
    const slug = `sample-replay-${Date.now().toString(36)}`;
    launch(newJob({ slug, name: sample.name, hint: sample.hint, photos: 0, mock: true, sample: true, bookSlug: SAMPLE.slug }), () => replay(runner, sample));
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

  const slug = familySlug(v.value.name, slugTaken);
  const key = newKey();
  launch(newJob({ slug, name: v.value.name, hint: v.value.hint, photos: photos.length }), () =>
    runReal({ slug, name: v.value.name, hint: v.value.hint, keywords: cleanKeywords(req.keywords), origin: req.origin, keyHash: keyHash(key), audio: { bytes: audio.bytes }, photos: photos.map((p) => p.bytes) }),
  );
  return { ok: true, slug, key };
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
  await withScope(runner.spendScope(slug), async () => {
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
    for (const [i, bytes] of input.photos.entries()) await reencodePhoto(bytes, join(dir, `source/photo-${i + 1}.jpg`));
    await writeRecord(record);
    update((j) => Object.assign(j, { audio: audioUrl(slug), durationMs: record.durationMs }));

    // 2. Muse Voice Transcribe: turns with start times and speaker labels.
    let t = record.transcript;
    if (!t) {
      log({ step: "transcribe", kind: "info", model: MODELS.transcribe, message: `transcribing ${clock((record.durationMs ?? 0) / 1000)} of audio (English, Malay, Mandarin, Tamil; speakers labelled)` });
      const started = Date.now();
      t = await scoped("transcribe", undefined, () => transcribe(recordingFile(slug, "wav"), { keywords: input.keywords, note: `family: ${slug}` }));
      record = { ...record, transcript: t, durationMs: t.durationMs || record.durationMs };
      await writeRecord(record);
      log({ step: "transcribe", kind: "info", model: MODELS.transcribe, message: `${t.turns.length} turns${t.untimed ? " (no timestamps came back; citing transcript lines)" : ""} in ${Math.round((Date.now() - started) / 1000)} s` });
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
    update((j) => Object.assign(j, { tagline: story.tagline, born: story.born, scenes: jobScenes(story, j.scenes) }));
    step("storyboard", "done");

    await Promise.all([runScenes(runner, slug), frontRun(slug)]);
    await runFilms(runner, slug);
    await writeCredit(slug, creditFor(runner.live(), input.sample));
  });
}

export function creditFor(job: Pick<FamilyJob, "frontispiece">, sample?: boolean) {
  const lead = sample ? `${SAMPLE.label}; nobody in this book is real. ` : "";
  return job.frontispiece?.kind === "photo"
    ? { kind: "reader-photo", text: `${lead}Traced from a family photo, shared with the family's consent; no face was generated.`, masked: "SAM 3.1" }
    : { kind: "emblem", text: `${lead}Frontispiece: an emblem of the life painted by Muse Image, cut out with SAM 3.1 and traced in pen lines. Not a likeness.`, masked: "SAM 3.1" };
}

/**
 * The frontispiece: a family photo (SAM 3.1 finds the person; the first photo it finds one in is
 * traced) or, without one, a Muse Image emblem. Photos are only ever traced, never sent to an
 * image generator, so no face is made up.
 */
async function frontRun(slug: string) {
  const job = runner.live();
  const dir = storyDir(slug);
  step("frontispiece", "running");
  try {
    await scoped("frontispiece", undefined, async () => {
      const photos = Array.from({ length: job.photos }, (_, i) => join(dir, `source/photo-${i + 1}.jpg`)).filter((f) => existsSync(f));
      for (const file of photos) {
        update((j) => void (j.frontispiece = { kind: "photo" }));
        const shown = await showSource(slug, sharp(file).resize(700, 900, { fit: "inside" }).greyscale());
        update((j) => void (j.frontispiece!.image = shown));
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
      const { file, concept } = await emblemSource(slug, `a treasured household object that stands for the life of ${job.name}`, (emblem) =>
        log({ step: "frontispiece", kind: "info", model: MODELS.image, message: `painting an emblem: ${emblem.concept}` }),
      );
      const shown = await showSource(slug, sharp(file).resize(700, 900, { fit: "inside" }));
      update((j) => void (j.frontispiece!.image = shown));
      log({ step: "frontispiece", kind: "asset", model: MODELS.image, message: "emblem", url: shown });
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

// ---------- Deleting ----------

/** Delete a family book and its recording. Needs the book's delete key; the sample can't be deleted from the web. */
export async function deleteBook(slug: string, key: string | null | undefined): Promise<{ ok: true } | ({ ok: false } & Refusal)> {
  const r = readRecord(slug);
  if (!r) return { ok: false, status: 404, error: "There is no family book by that name." };
  if (r.sample) return { ok: false, status: 403, error: "The sample book stays; it is the demo." };
  if (!keyOk(key, r.keyHash)) return { ok: false, status: 403, error: "Only the browser that made this book (or its private delete link) can delete it." };
  if (runner.state.running && runner.state.job?.slug === slug) return { ok: false, status: 409, error: "This book is still being made; delete it once it finishes." };
  for (const p of bookPaths(slug)) await rm(p, { recursive: true, force: true });
  if (runner.state.job?.slug === slug) runner.state.job = null;
  return { ok: true };
}
