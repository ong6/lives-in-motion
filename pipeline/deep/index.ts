/**
 * The deep edition: twelve chapters told as a story, with real photographs among the plates.
 * `pnpm make <slug> --deep [--stages a,b] [--scenes s3,s7] [--force]`. Its inputs are the research
 * agent's stories/<slug>/deep/{research,storyboard,meta}.json and pipeline/photos/<slug>/ (read only).
 *
 *   write        Muse Spark writes the final chapters from the numbered facts and the draft;
 *                code checks quotes, sources, word counts and the content rules, and sends any
 *                problems back for a repair (stories/<slug>/written.json).
 *   assemble     story.json from the written chapters, the storyboard's treatments and art, and
 *                each chapter's sources from its fact numbers. Keeps art already made.
 *   verify       Muse Spark with web search checks each chapter against its sources.
 *   fix          Chapters the check disputed go back to Spark once, then are re-assembled and re-checked.
 *   photos       Photo chapters and breaks: the real photo, SAM 3.1's mask of its subject, and a
 *                linedraw pen trace that draws over it.
 *   frontispiece Traced from the life's best photo (or an object, where no photo of the person exists).
 *   illustrate, segment, line   Muse Image plates and SAM 3.1 cut-outs (pipeline/stages.ts).
 *   films        Muse Wonder directs each plate's film (critic pass mark 8, best round kept);
 *                line films and any undirected plate are rendered locally.
 *
 * Every stage skips work already on disk, so a run that drops can be started again.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { Story, type Photo, type Scene, type Story as StoryT } from "../../lib/schema";
import { withScope } from "../budget";
import { MODELS, sparkJson, sparkSearch } from "../meta";
import { drawLines, frontispiece as traceFrontispiece } from "../portrait";
import { ROOT } from "../root";
import { conceptMask, fillHoles, personMask } from "../sam";
import { edit, fitCaption, illustrate, line, loadStory, parseVerdict, pool, print, segment, storyDir, type OnEvent } from "../stages";
import { OFF_LIMITS, checkChapters, sourcesFor, type ResearchFact, type Written } from "./check";
import { BANNED, LIVES, type LifeConfig, type PhotoUse } from "./config";
import { WRITE_SYSTEM, deepVerifyPrompt, repairInput, writeInput, writeSchema } from "./prompts";

export const DEEP_STAGES = ["write", "assemble", "verify", "fix", "photos", "frontispiece", "illustrate", "segment", "line", "films"] as const;
export type DeepStage = (typeof DEEP_STAGES)[number];

/** Most one life's deep run may spend, all models together. */
export const DEEP_LIMIT = Number(process.env.DEEP_LIMIT_USD ?? 8);
const REPAIRS = 3;

interface StoryboardChapter {
  n: number;
  year: string;
  title: string;
  treatment: "plate" | "line" | "archive" | "photo";
  body: string;
  voice?: string;
  facts: number[];
  art?: { direction: string; cut: string[] } | null;
  photo?: { file: string; note?: string } | null;
}
interface PhotoMeta {
  file: string;
  title: string;
  year: string;
  depicts: string;
  kind: "person" | "place";
  page: string;
  license: string;
  licenseUrl?: string | null;
  artist: string;
  width: number;
  height: number;
  quality: "good" | "ok" | "poor";
}
interface WrittenFile {
  model: string;
  at: string;
  rounds: number;
  problems: string[];
  chapters: Written[];
  conflicts: { topic: string; choice: string }[];
}

/**
 * One writing call. Muse Spark can spend its whole budget reasoning and return nothing (finish
 * "length"); that is paid, so it is retried once at a lower effort rather than with a bigger cap.
 */
async function spark<T>(user: string, name: string): Promise<T> {
  try {
    return await sparkJson<T>(WRITE_SYSTEM, user, name, writeSchema, { maxTokens: 32000, effort: "medium" });
  } catch (e) {
    if (!/returned no content|answered .* with null/.test(String((e as Error)?.message))) throw e;
    return sparkJson<T>(WRITE_SYSTEM, user, `${name}-low`, writeSchema, { maxTokens: 24000, effort: "low" });
  }
}

const json = async <T>(f: string): Promise<T> => JSON.parse(await readFile(f, "utf8"));
const deepDir = (slug: string) => join(storyDir(slug), "deep");
const writtenFile = (slug: string) => join(storyDir(slug), "written.json");
const verifyFile = (slug: string) => join(storyDir(slug), "verify.json");
const pub = (slug: string, id: string, name: string) => ({ url: `/stories/${slug}/${id}/${name}`, file: join(ROOT, "public/stories", slug, id, name) });

function config(slug: string): LifeConfig {
  const c = LIVES[slug];
  if (!c) throw new Error(`no deep-edition config for ${slug} (pipeline/deep/config.ts)`);
  return c;
}

async function inputs(slug: string) {
  const research = await json<{ name: string; facts: ResearchFact[]; conflicts?: { topic: string; detail: string }[] }>(join(deepDir(slug), "research.json"));
  const board = await json<{ chapters: StoryboardChapter[] }>(join(deepDir(slug), "storyboard.json"));
  const photos = await json<PhotoMeta[]>(join(ROOT, "pipeline/photos", slug, "photos.json"));
  return { research, board, photos };
}

/** Name, dates and tagline: the new lives' meta.json, or the life's current story. */
async function identity(slug: string): Promise<{ name: string; born: string; died: string | null; tagline: string; listed?: boolean }> {
  const meta = join(deepDir(slug), "meta.json");
  const current = existsSync(join(storyDir(slug), "story.json")) ? await loadStory(slug) : undefined;
  if (existsSync(meta)) {
    const m = await json<{ name: string; born: string; died: string | null; tagline: string }>(meta);
    // A new life stays off the shelf until it is finished and approved.
    return { name: m.name, born: m.born, died: m.died, tagline: m.tagline, listed: current ? current.listed : false };
  }
  if (!current) throw new Error(`${slug}: no meta.json and no story.json to take the name and dates from`);
  return { name: current.name, born: current.born, died: current.died, tagline: current.tagline, listed: current.listed };
}

/** The storyboard's treatment, unless the chapter's photograph is one we may not use. */
function treatmentOf(ch: StoryboardChapter): Scene["treatment"] {
  if (ch.treatment === "photo") return ch.photo && !BANNED.includes(ch.photo.file) ? "photo" : "theatre";
  return ch.treatment === "plate" ? "theatre" : ch.treatment;
}

/** Original photo: a re-downloaded copy in stories/<slug>/source/photos (the committed one was truncated) wins. */
const photoSource = (slug: string, file: string) => {
  const fixed = join(storyDir(slug), "source/photos", file);
  return existsSync(fixed) ? fixed : join(ROOT, "pipeline/photos", slug, file);
};

// ---------- write ----------

export async function write(slug: string, { force = false, on = print }: { force?: boolean; on?: OnEvent } = {}): Promise<WrittenFile> {
  if (!force && existsSync(writtenFile(slug))) {
    const w = await json<WrittenFile>(writtenFile(slug));
    on({ stage: "storyboard", kind: "info", message: `chapters already written (${w.problems.length} open problems)` });
    return w;
  }
  const { research, board } = await inputs(slug);
  const who = await identity(slug);
  const cfg = config(slug);
  const draft = board.chapters.map((c) => ({ ...c, treatment: treatmentOf(c) === "theatre" ? "plate" : treatmentOf(c) }));
  const input = writeInput({ name: who.name, born: who.born, died: who.died, facts: research.facts, conflicts: research.conflicts ?? [], draft, notes: cfg.notes });
  on({ stage: "storyboard", kind: "info", model: MODELS.spark, message: `writing ${draft.length} chapters from ${research.facts.length} facts` });
  let answer = await spark<{ chapters: Written[]; conflicts: WrittenFile["conflicts"] }>(input, `deep-write-${slug}`);
  let result = checkChapters(answer.chapters, research.facts, Number(who.born), draft.length);
  let rounds = 1;
  while (result.problems.length && rounds <= REPAIRS) {
    on({ stage: "storyboard", kind: "warn", model: MODELS.spark, message: `${result.problems.length} problems; repair ${rounds}: ${result.problems.slice(0, 3).join(" · ")}` });
    answer = await spark(`${input}\n\n${repairInput(answer, result.problems)}`, `deep-repair-${slug}-${rounds}`);
    result = checkChapters(answer.chapters, research.facts, Number(who.born), draft.length);
    rounds++;
  }
  const out: WrittenFile = { model: MODELS.spark, at: new Date().toISOString(), rounds, problems: result.problems, chapters: result.chapters, conflicts: answer.conflicts };
  await writeFile(writtenFile(slug), JSON.stringify(out, null, 2) + "\n");
  on({ stage: "storyboard", kind: result.problems.length ? "warn" : "board", model: MODELS.spark, message: `${out.chapters.length} chapters in ${rounds} round${rounds > 1 ? "s" : ""}${result.problems.length ? `; still open: ${result.problems.join(" · ")}` : ""}` });
  return out;
}

// ---------- assemble ----------

/** The first sentence of the body, for the shelf, the workbench and the film director's brief. */
const hookOf = (body: string) => fitCaption(body.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? body);

/** Files from an earlier, 7-scene edition of a life that the deep edition replaces. */
async function retireOldEdition(slug: string, on: OnEvent) {
  await rm(join(ROOT, "public/stories", slug), { recursive: true, force: true });
  for (const f of ["verify.json", "research.json", "research.raw.json", "emblem.json", "credit.json"]) await rm(join(storyDir(slug), f), { force: true });
  on({ stage: "storyboard", kind: "info", message: "retired the earlier edition's plates, films and checks" });
}

export async function assemble(slug: string, on: OnEvent = print): Promise<StoryT> {
  const { research, board, photos } = await inputs(slug);
  const written = await json<WrittenFile>(writtenFile(slug));
  const who = await identity(slug);
  const cfg = config(slug);
  const before = existsSync(join(storyDir(slug), "story.json")) ? await loadStory(slug) : undefined;
  if (before && before.edition !== "deep") await retireOldEdition(slug, on);
  const kept = before?.edition === "deep" ? before : undefined;

  let lastYear = 0;
  const scenes: Scene[] = written.chapters.map((c, i) => {
    const ch = board.chapters[i];
    const id = `s${i + 1}`;
    const treatment = treatmentOf(ch);
    const art = cfg.replace?.[ch.n] ?? { direction: cfg.art?.[ch.n]?.direction ?? ch.art?.direction ?? "", cut: cfg.art?.[ch.n]?.cut ?? ch.art?.cut ?? [] };
    const use = treatment === "photo" ? cfg.photos[ch.n] : undefined;
    if (treatment === "photo" && !use) throw new Error(`${slug} chapter ${ch.n}: photo chapter without a label in config.ts`);
    // Chronological, as the shelf and the rail expect: an approximate year never runs backwards.
    const year = String(Math.max(Number(c.year) || lastYear, lastYear));
    lastYear = Number(year);
    const fact = c.quote ? research.facts.find((f) => f.n === c.quote!.fact) : undefined;
    const old = kept?.scenes.find((s) => s.id === id);
    const visual = use ? use.label : art.direction;
    const scene: Scene = {
      id,
      treatment,
      year,
      ...(c.when && c.when !== year ? { when: c.when } : {}),
      title: c.title,
      caption: hookOf(c.body),
      body: c.body,
      voice: c.voice,
      turn: c.turn,
      ...(c.age != null ? { age: c.age } : {}),
      ...(fact && c.quote ? { quote: { text: c.quote.text, speaker: fact.speaker ?? who.name, source: fact.sources[0] } } : {}),
      visual,
      cut: art.cut.slice(0, 2),
      sources: sourcesFor(c.facts, research.facts),
      layers: [],
    };
    // Art already made for this chapter stays, as long as it was made for the same picture.
    if (old && old.treatment === treatment && old.visual === visual) {
      for (const k of ["plate", "background", "line", "video", "poster", "photo"] as const) if (old[k]) (scene as any)[k] = old[k];
      scene.layers = old.layers;
    }
    if (old?.checked && old.body === scene.body) scene.checked = old.checked;
    if (treatment === "photo") {
      const meta = photos.find((p) => p.file === ch.photo!.file);
      if (!meta) throw new Error(`${slug} chapter ${ch.n}: ${ch.photo!.file} is not in photos.json`);
    }
    return scene;
  });
  const story = Story.parse({
    slug,
    name: who.name,
    born: who.born,
    died: who.died,
    tagline: who.tagline,
    ...(who.listed === false ? { listed: false } : {}),
    edition: "deep",
    // The book prints how each conflict was settled, but never a war or a party, even in a note.
    conflicts: written.conflicts.filter((c) => !OFF_LIMITS.test(`${c.topic} ${c.choice}`)),
    ...(kept?.breaks ? { breaks: kept.breaks } : {}),
    scenes,
  });
  await edit(slug, () => story, { create: true });
  on({ stage: "storyboard", kind: "board", message: `${scenes.length} chapters: ${scenes.filter((s) => s.treatment === "photo").length} photo, ${scenes.filter((s) => s.treatment !== "photo").length} illustrated` });
  return story;
}

// ---------- verify and fix ----------

interface VerifyRow {
  id: string;
  year: string;
  title: string;
  model: string;
  at: string;
  verdict: "ok" | "disputed";
  reason: string;
  raw: string;
  sources: string[];
}

/** Whether Muse Spark's answer ends in a verdict at all (it sometimes stops while still narrating its search). */
export const hasVerdict = (text: string) => /(?:^|[^A-Za-z])(OK|WRONG)\**\s*[|:]/i.test(text);
/** A dispute the writer should act on: an explicit WRONG with a reason, not a missing verdict. */
const realDispute = (r: VerifyRow) => r.verdict === "disputed" && /(?:^|[^A-Za-z])WRONG\**\s*[|:]/i.test(r.raw);

export async function verify(slug: string, { only, force = false, on = print }: { only?: string[]; force?: boolean; on?: OnEvent } = {}) {
  const story = await loadStory(slug);
  const before: VerifyRow[] = existsSync(verifyFile(slug)) ? await json<VerifyRow[]>(verifyFile(slug)) : [];
  // A run stopped mid-stage leaves verdicts in story.json but no report row: an OK is copied
  // across; a dispute is asked again (its reasons are gone with the report).
  for (const sc of story.scenes)
    if (sc.checked?.verdict === "ok" && !before.some((r) => r.id === sc.id))
      before.push({ id: sc.id, year: sc.year, title: sc.title, model: sc.checked.model, at: sc.checked.at, verdict: "ok", reason: sc.checked.note ?? "", raw: `OK | ${sc.checked.note ?? ""}`, sources: sc.checked.sources });
  // Unchecked chapters, and any whose earlier answer never reached a verdict or lost its report.
  const unanswered = (id: string) => !before.some((r) => r.id === id && hasVerdict(r.raw));
  const todo = story.scenes.filter((s) => s.body && (!only || only.includes(s.id)) && (force || only || !s.checked || (s.checked.verdict === "disputed" && unanswered(s.id))));
  const rows: VerifyRow[] = before.filter((r) => !todo.some((s) => s.id === r.id));
  await pool(todo, 3, async (scene) => {
    let text = "";
    let urls: string[] = [];
    for (let attempt = 0; attempt < 2 && !hasVerdict(text); attempt++) {
      const r = await sparkSearch(deepVerifyPrompt(story.name, { ...scene, body: scene.body!, quote: scene.quote }, scene.sources.map((s) => s.url)), {
        context: "medium",
        maxOutput: 8000,
        maxSearches: 12,
        note: `deep verify ${slug} ${scene.id}${attempt ? " again" : ""}`,
      });
      text = r.text.trim();
      urls = [...new Set(r.citations.map((c) => c.url))];
    }
    if (!hasVerdict(text)) {
      // No verdict is not a dispute: the chapter stays unmarked and is asked again next run.
      await edit(slug, (s) => void delete s.scenes.find((x) => x.id === scene.id)!.checked);
      rows.push({ id: scene.id, year: scene.year, title: scene.title, model: MODELS.spark, at: new Date().toISOString(), verdict: "disputed", reason: "no verdict returned", raw: text, sources: urls });
      return on({ stage: "verify", scene: scene.id, kind: "warn", model: MODELS.spark, message: "no verdict returned; left unchecked" });
    }
    const v = parseVerdict(text);
    const row: VerifyRow = { id: scene.id, year: scene.year, title: scene.title, model: MODELS.spark, at: new Date().toISOString(), verdict: v.verdict, reason: v.note, raw: text, sources: urls };
    rows.push(row);
    await edit(slug, (s) => void (s.scenes.find((x) => x.id === scene.id)!.checked = { model: row.model, verdict: v.verdict, at: row.at, note: v.note, sources: row.sources }));
    on({ stage: "verify", scene: scene.id, kind: v.verdict === "ok" ? "info" : "warn", model: MODELS.spark, message: `${v.verdict.toUpperCase()} | ${v.note}` });
  });
  rows.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  await writeFile(verifyFile(slug), JSON.stringify(rows, null, 2) + "\n");
  return rows.filter(realDispute);
}

/**
 * Chapters to rewrite: those Muse Spark disputed (an explicit WRONG), and those that fail checks
 * added since they were written. They go back to the writer once (two repairs at most) with their
 * problems; only those chapters change, are re-assembled and checked again. A dispute the rewrite
 * cannot settle from the facts stays marked "Queried" on the page.
 */
export async function fix(slug: string, on: OnEvent = print) {
  const story = await loadStory(slug);
  const disputed = existsSync(verifyFile(slug)) ? (await json<VerifyRow[]>(verifyFile(slug))).filter(realDispute).filter((r) => story.scenes.find((s) => s.id === r.id)?.checked?.verdict === "disputed") : [];
  const { research, board } = await inputs(slug);
  const w = await json<WrittenFile>(writtenFile(slug));
  const who = await identity(slug);
  const n = board.chapters.length;
  const byChapter = new Map<number, string[]>();
  const add = (c: number, p: string) => byChapter.set(c, [...(byChapter.get(c) ?? []), p]);
  for (const p of checkChapters(w.chapters, research.facts, Number(who.born), n).problems) {
    const m = p.match(/^chapter (\d+):/);
    if (m) add(Number(m[1]), p);
  }
  for (const r of disputed) add(Number(r.id.slice(1)), `chapter ${r.id.slice(1)}: a web fact-check disputed it: ${r.reason}. Correct the chapter to match its facts, or leave the disputed claim out.`);
  if (!byChapter.size) return on({ stage: "verify", kind: "info", message: "no disputed or failing chapters" });
  const targets = [...byChapter.keys()].sort((a, b) => a - b);
  const only = (ps: string[]) => ps.filter((p) => targets.some((t) => p.startsWith(`chapter ${t}:`)));
  const cfg = config(slug);
  const draft = board.chapters.map((c) => ({ ...c, treatment: treatmentOf(c) === "theatre" ? "plate" : treatmentOf(c) }));
  const input = writeInput({ name: who.name, born: who.born, died: who.died, facts: research.facts, conflicts: research.conflicts ?? [], draft, notes: cfg.notes });
  const problems = [...[...byChapter.values()].flat(), `Change only chapters ${targets.join(", ")}; return the others exactly as they are.`];
  on({ stage: "verify", kind: "info", model: MODELS.spark, message: `rewriting ${targets.map((t) => `s${t}`).join(", ")}` });
  let answer = await spark<{ chapters: Written[]; conflicts: WrittenFile["conflicts"] }>(`${input}\n\n${repairInput(w, problems)}`, `deep-fix-${slug}`);
  let result = checkChapters(answer.chapters, research.facts, Number(who.born), n);
  for (let r = 0; only(result.problems).length && r < 2; r++) {
    answer = await spark(`${input}\n\n${repairInput(answer, only(result.problems))}`, `deep-fix-repair-${slug}-${r}`);
    result = checkChapters(answer.chapters, research.facts, Number(who.born), n);
  }
  // A chapter whose rewrite still fails keeps its earlier text.
  const failed = new Set(only(result.problems).map((p) => Number(p.match(/^chapter (\d+):/)![1])));
  const changed = targets.filter((t) => !failed.has(t) && result.chapters[t - 1]);
  if (failed.size) on({ stage: "verify", kind: "warn", message: `kept the earlier text of ${[...failed].map((t) => `s${t}`).join(", ")}: ${only(result.problems).join(" · ")}` });
  if (!changed.length) return;
  const chapters = w.chapters.map((c) => (changed.includes(c.n) ? result.chapters[c.n - 1] : c));
  await writeFile(writtenFile(slug), JSON.stringify({ ...w, at: new Date().toISOString(), chapters }, null, 2) + "\n");
  await assemble(slug, on);
  const ids = changed.map((t) => `s${t}`);
  const still = await verify(slug, { only: ids, on });
  // A disputed chapter rewritten to match its sources and then passed is recorded as corrected.
  for (const r of disputed)
    if (ids.includes(r.id) && !still.some((x) => x.id === r.id))
      await edit(slug, (s) => {
        const sc = s.scenes.find((x) => x.id === r.id)!;
        if (sc.checked) sc.checked = { ...sc.checked, verdict: "corrected", note: `${r.reason.slice(0, 200)} → Rewritten from the research and checked again: ${sc.checked.note ?? "OK"}` };
      });
}

// ---------- photos ----------

const TRACE_W = 1024;

/** A 0/1 mask of the photo's subject from SAM 3.1, cached beside the published photo. */
async function subjectMask(file: string, img: Buffer, w: number, h: number, use: PhotoUse): Promise<Uint8Array | null> {
  if (existsSync(file)) {
    const raw = await sharp(file).resize(w, h, { fit: "fill" }).extractChannel(0).raw().toBuffer();
    const m = Uint8Array.from(raw, (v) => (v > 127 ? 1 : 0));
    // An empty mask cached by an earlier run is asked again (the concept fallbacks may find it).
    if (m.some(Boolean)) return m;
  }
  let m: Uint8Array | null = null;
  if (use.concept === "person") m = await personMask(img, w, h, use.include ?? []);
  // A phrase SAM can't find ("inflatable toilet") falls back to its head noun ("toilet").
  else
    for (const c of [...new Set([use.concept, use.concept.split(" ").at(-1)!])]) {
      m = await conceptMask(img, c, w, h).then((x) => (x ? fillHoles(x, w, h) : null));
      if (m) break;
    }
  // An empty mask is cached too; a rerun asks again.
  await sharp(Buffer.from((m ?? new Uint8Array(w * h)).map((v) => v * 255)), { raw: { width: w, height: h, channels: 1 } }).png().toFile(file);
  return m;
}

/** The mask's bounding box in pixels, grown by `pad` of its larger side and kept in the frame. */
function boundsOf(m: Uint8Array, w: number, h: number, pad = 0): { x: number; y: number; w: number; h: number } | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (y0 = Math.min(y0, y)), (y1 = Math.max(y1, y));
  if (x1 < x0) return null;
  const p = Math.round(Math.max(x1 - x0, y1 - y0) * pad);
  const x = Math.max(0, x0 - p), y = Math.max(0, y0 - p);
  return { x, y, w: Math.min(w, x1 + p + 1) - x, h: Math.min(h, y1 + p + 1) - y };
}

/** Centre of the mask's bounding box, as fractions of the frame. */
function focusOf(m: Uint8Array, w: number, h: number): [number, number] {
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (y0 = Math.min(y0, y)), (y1 = Math.max(y1, y));
  return x1 > x0 ? [+((x0 + x1) / 2 / w).toFixed(3), +((y0 + y1) / 2 / h).toFixed(3)] : [0.5, 0.5];
}

/**
 * One photograph prepared for the page: the photo itself (resized), SAM 3.1's mask of its subject
 * and that cut-out on transparency (the Layers view), and the pen trace of the subject over the
 * whole frame (unit coordinates, so it lies exactly over the photo). `trace: false` for a break.
 */
export async function preparePhoto(slug: string, dir: string, meta: PhotoMeta, use: PhotoUse, opts: { trace: boolean }, on: OnEvent = print): Promise<Photo> {
  await mkdir(join(ROOT, "public/stories", slug, dir), { recursive: true });
  let img = sharp(photoSource(slug, meta.file), { failOn: "none" }).rotate();
  const m0 = await sharp(await img.toBuffer()).metadata();
  if (use.crop) {
    const [l, t, w, h] = use.crop;
    img = sharp(await img.toBuffer()).extract({ left: Math.round(l * m0.width!), top: Math.round(t * m0.height!), width: Math.round(w * m0.width!), height: Math.round(h * m0.height!) });
  }
  const full = await img.png().toBuffer();
  const { width: W, height: H } = await sharp(full).metadata();
  const aspect = +(H! / W!).toFixed(4);
  const photo = pub(slug, dir, "photo.webp");
  await sharp(full).resize(1800, 1800, { fit: "inside", withoutEnlargement: true }).webp({ quality: 84 }).toFile(photo.file);
  const mounted = use.mounted ?? (Math.min(W!, H!) < 900 || meta.quality === "poor");
  const out: Photo = {
    src: photo.url,
    aspect,
    kind: meta.kind,
    concept: use.concept,
    label: use.label,
    ...(use.tag ? { tag: use.tag } : {}),
    year: meta.year,
    ...(mounted ? { mounted: true } : {}),
    credit: { artist: meta.artist, license: meta.license, licenseUrl: meta.licenseUrl || null, page: meta.page },
  };
  if (!opts.trace) return out;

  const tw = TRACE_W, th = Math.round(TRACE_W * aspect);
  const small = await sharp(full).resize(tw, th, { fit: "fill" }).removeAlpha().png().toBuffer();
  on({ stage: "line", scene: dir, kind: "info", model: MODELS.sam, message: `SAM 3.1 looks for “${use.concept}” in ${meta.file}` });
  const mask = await subjectMask(pub(slug, dir, "mask.png").file, small, tw, th, use);
  if (mask) {
    out.focus = focusOf(mask, tw, th);
    // The cut-out: the photo with SAM's mask as its alpha, for the Layers view.
    const alpha = await sharp(Buffer.from(mask.map((v) => v * 255)), { raw: { width: tw, height: th, channels: 1 } }).blur(1.5).extractChannel(0).raw().toBuffer();
    const cut = pub(slug, dir, "cutout.webp");
    await sharp(small).removeAlpha().joinChannel(alpha, { raw: { width: tw, height: th, channels: 1 } }).webp({ quality: 82, alphaQuality: 85 }).toFile(cut.file);
    out.cutout = cut.url;
  } else on({ stage: "line", scene: dir, kind: "warn", model: MODELS.sam, message: `SAM found no “${use.concept}”; tracing the whole frame` });

  // The trace: the subject only, everything else white. A face's mid-tones are lifted so they
  // aren't hatched solid; an object or a building keeps its tones (a white object would vanish).
  const person = use.concept === "person";
  const soft = mask ? await sharp(Buffer.from(mask.map((v) => v * 255)), { raw: { width: tw, height: th, channels: 1 } }).blur(2).extractChannel(0).raw().toBuffer() : null;
  // A small subject is drawn from a close crop at full resolution, then placed back in the frame.
  const box = mask ? boundsOf(mask, tw, th, 0.06) : null;
  const close = box && box.w * box.h < 0.3 * tw * th ? box : null;
  const pen = mask && person ? { hatch: 14, light: 64 } : mask ? { hatch: 11, light: 82 } : { hatch: 18, light: 48 };
  /** Trace at one tone curve: lift and gamma brighten mid-tones so a face isn't hatched solid. */
  const traceAt = async (lift: number, gamma: number) => {
    const { data, info } = await sharp(small).removeAlpha().normalise().linear(lift, 0).gamma(gamma).raw().toBuffer({ resolveWithObject: true });
    if (soft)
      for (let i = 0; i < data.length; i++) {
        const a = soft[Math.floor(i / info.channels)] / 255;
        data[i] = Math.round(data[i] * a + 255 * (1 - a));
      }
    let img = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer();
    if (!close) return drawLines(img, pen);
    img = await sharp(img).extract({ left: close.x, top: close.y, width: close.w, height: close.h }).resize({ width: TRACE_W }).png().toBuffer();
    return (await drawLines(img, pen)).map((st) => st.map((v, k) => +((k % 2 ? close.y + v * close.w : close.x + v * close.w) / tw).toFixed(4)));
  };
  // A light photo (a white shirt, a pale object) can wash out under the lift: step it down until the pen has enough to draw.
  const curves: [number, number][] = mask && person ? [[1.4, 2.0], [1.15, 1.4], [1, 1]] : [[1.05, 1.2], [1, 1]];
  let strokes: number[][] = [];
  for (const [lift, gamma] of curves) {
    strokes = await traceAt(lift, gamma);
    if (strokes.length >= 250) break;
  }
  const trace = pub(slug, dir, "trace.json");
  const sa = /SA/.test(meta.license);
  await writeFile(
    trace.file,
    JSON.stringify({
      aspect,
      strokes,
      credit: { artist: meta.artist, license: meta.license, page: meta.page, masked: mask ? "SAM 3.1" : "none", ...(sa ? { shareAlike: `This pen trace is shared under ${meta.license}.` } : {}) },
    }),
  );
  out.trace = trace.url;
  on({ stage: "line", scene: dir, kind: "line", message: `pen trace in ${strokes.length} strokes${mask ? ", subject masked by SAM 3.1" : ""}`, url: trace.url });
  return out;
}

export async function photos(slug: string, { only, force = false, on = print }: { only?: string[]; force?: boolean; on?: OnEvent } = {}) {
  const { board, photos: metas } = await inputs(slug);
  const cfg = config(slug);
  const story = await loadStory(slug);
  for (const [i, ch] of board.chapters.entries()) {
    const id = `s${i + 1}`;
    const scene = story.scenes[i];
    if (scene?.treatment !== "photo" || (only && !only.includes(id))) continue;
    if (scene.photo?.trace && !force && !only) {
      on({ stage: "line", scene: id, kind: "info", message: "photo already prepared" });
      continue;
    }
    const meta = metas.find((p) => p.file === ch.photo!.file)!;
    const photo = await preparePhoto(slug, id, meta, cfg.photos[ch.n], { trace: true }, on);
    await edit(slug, (s) => void (s.scenes[i].photo = photo));
  }
  // Breaks: a full spread, the photo alone.
  if (cfg.breaks?.length && !only) {
    const breaks: { after: string; photo: Photo }[] = [];
    for (const b of cfg.breaks) {
      const meta = metas.find((p) => p.file === b.file);
      if (!meta || BANNED.includes(b.file)) throw new Error(`${slug}: break photo ${b.file} is not usable`);
      breaks.push({ after: `s${b.after}`, photo: await preparePhoto(slug, `break-${b.after}`, meta, b.use, { trace: false }, on) });
    }
    await edit(slug, (s) => void (s.breaks = breaks));
    on({ stage: "line", kind: "info", message: `${breaks.length} full-spread photo break${breaks.length > 1 ? "s" : ""}` });
  }
}

// ---------- frontispiece ----------

const CREDITS = join(ROOT, "pipeline/portraits/credits.json");

export async function frontis(slug: string, { force = false, on = print }: { force?: boolean; on?: OnEvent } = {}) {
  const cfg = config(slug);
  const lines = join(ROOT, "public/lines", `${slug}.json`);
  const credits = await json<Record<string, any>>(CREDITS);
  const fp = cfg.frontispiece;
  if (fp === "keep") {
    if (!existsSync(lines) || !credits[slug]) throw new Error(`${slug}: frontispiece marked "keep" but none is traced and credited`);
    return on({ stage: "frontispiece", kind: "info", message: "keeps its traced frontispiece" });
  }
  const { photos: metas } = await inputs(slug);
  const meta = metas.find((p) => p.file === fp.file);
  if (!meta || BANNED.includes(meta.file)) throw new Error(`${slug}: frontispiece photo ${fp.file} is not usable`);
  if (!force && existsSync(lines) && credits[slug]?.title === meta.title) return on({ stage: "frontispiece", kind: "info", message: "frontispiece already traced" });
  const src = join(storyDir(slug), "source", `frontis${meta.file.match(/\.\w+$/)![0]}`);
  await mkdir(join(storyDir(slug), "source"), { recursive: true });
  await copyFile(photoSource(slug, meta.file), src);
  if (force) await rm(src.replace(/\.\w+$/, ".mask.png"), { force: true });
  on({ stage: "frontispiece", kind: "info", model: MODELS.sam, message: `tracing ${meta.file} (SAM 3.1 finds “${fp.concept}”)` });
  const p = await traceFrontispiece(slug, src, fp.concept, { page: meta.page, license: meta.license, licenseUrl: meta.licenseUrl || null, artist: meta.artist });
  credits[slug] = { title: meta.title, page: meta.page, license: meta.license, licenseUrl: meta.licenseUrl || null, artist: meta.artist, ...(fp.depicts ? { depicts: fp.depicts } : {}) };
  await writeFile(CREDITS, JSON.stringify(credits, null, 2) + "\n");
  on({ stage: "frontispiece", kind: "line", message: `frontispiece in ${p.strokes.length} strokes`, url: `/lines/${slug}.json` });
}

// ---------- films ----------

/** Muse Wonder directs every plate's film; line films and undirected plates are rendered locally. */
export async function films(slug: string, { only, force = false, on = print }: { only?: string[]; force?: boolean; on?: OnEvent } = {}) {
  const { directScene, MIN_SCORE } = await import("../wonder");
  const story = await loadStory(slug);
  const reportFile = join(ROOT, "public/stories", slug, "wonder.json");
  const report: { scenes: Record<string, any> } = existsSync(reportFile) ? await json(reportFile) : { scenes: {} };
  const save = () =>
    writeFile(
      reportFile,
      JSON.stringify({ model: MODELS.wonder, updated: new Date().toISOString(), usd: +Object.values(report.scenes).reduce((a: number, x: any) => a + (x.usd ?? 0), 0).toFixed(4), passMark: MIN_SCORE, scenes: report.scenes }, null, 2) + "\n",
    );
  const todo = story.scenes.filter((s) => (s.treatment === "theatre" || s.treatment === "archive") && s.plate && (!only || only.includes(s.id)) && (force || only || !report.scenes[s.id]));
  for (const s of todo) {
    on({ stage: "films", scene: s.id, kind: "info", model: MODELS.wonder, message: `Muse Wonder directs “${s.title}”` });
    let r;
    try {
      r = await directScene(slug, story.name, s, { maxRounds: 2, effort: "low", log: (m) => on({ stage: "films", scene: s.id, kind: "info", model: MODELS.wonder, message: m }) });
    } catch (e) {
      if ((e as Error)?.name === "BudgetError" || /budget:/.test(String(e))) throw e;
      on({ stage: "films", scene: s.id, kind: "warn", model: MODELS.wonder, message: `direction failed: ${String((e as Error)?.message ?? e).slice(0, 200)}` });
      continue;
    }
    report.scenes[s.id] = r;
    await save();
    if (r.status === "directed" && r.video) await edit(slug, (st) => void Object.assign(st.scenes.find((x) => x.id === s.id)!, { video: r.video, poster: r.poster }));
    on({ stage: "films", scene: s.id, kind: "info", model: MODELS.wonder, message: `→ ${r.status}${r.score != null ? ` (${r.score}/10${r.passed ? ", passed" : ""})` : ""}, $${r.usd.toFixed(3)}` });
  }
  // Everything else with a plate and no film yet: line films, and plates the critic never passed.
  const after = await loadStory(slug);
  const local = after.scenes.filter((s) => s.treatment !== "photo" && s.plate && !s.video && (!only || only.includes(s.id)) && (s.treatment !== "line" || s.line)).map((s) => s.id);
  if (local.length) {
    on({ stage: "films", kind: "info", message: `rendering ${local.join(", ")} locally` });
    await new Promise<void>((res, rej) => {
      const p = spawn(process.execPath, [join(ROOT, "node_modules/tsx/dist/cli.mjs"), join(ROOT, "pipeline/video.ts"), slug, "--scenes", local.join(",")], { cwd: ROOT, stdio: "inherit" });
      p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`pnpm video exited ${code}`))));
    });
  }
}

// ---------- the whole run ----------

export async function makeDeep(slug: string, stages: DeepStage[], opts: { only?: string[]; force?: boolean; on?: OnEvent } = {}) {
  const on = opts.on ?? print;
  await withScope({ job: `deep:${slug}`, limit: DEEP_LIMIT }, async () => {
    for (const stage of stages) {
      const t = Date.now();
      console.log(`▸ ${stage}`);
      if (stage === "write") await write(slug, { force: opts.force, on });
      else if (stage === "assemble") await assemble(slug, on);
      else if (stage === "verify") {
        const disputed = await verify(slug, { only: opts.only, force: opts.force, on });
        if (disputed.length) console.log(`  ${disputed.length} disputed: ${disputed.map((d) => d.id).join(", ")}`);
      } else if (stage === "fix") await fix(slug, on);
      else if (stage === "photos") await photos(slug, { only: opts.only, force: opts.force, on });
      else if (stage === "frontispiece") await frontis(slug, { force: opts.force, on });
      else if (stage === "illustrate") await illustrate(slug, { only: opts.only, on, parallel: 3 });
      else if (stage === "segment") await segment(slug, { only: opts.only, on, parallel: 3 });
      else if (stage === "line") await line(slug, { only: opts.only, on });
      else if (stage === "films") await films(slug, { only: opts.only, force: opts.force, on });
      console.log(`  done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
    }
  });
}
