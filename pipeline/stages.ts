/**
 * The stages that make a life, each reading what the one before wrote, so any can be rerun:
 * research → storyboard → (verify) → illustrate → segment → line. Scene-level work is exported
 * per scene so /create can run plates, cut-outs and line drawings side by side; every write to
 * story.json goes through `edit`, which serialises read-modify-writes and swaps the file in
 * atomically (the site reads it at request time while plates are still landing).
 *
 * Every stage reports through an `on` callback; the CLI's default prints it.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { Story, type Layer, type Scene, type Story as StoryT } from "../lib/schema";
import { eraFor } from "../lib/eras";
import { MODELS, museEdit, museImage, samRaw, sparkJson, sparkSearch, type Cited } from "./meta";
import { STORYBOARD_SYSTEM, cleanPlatePrompt, platePrompt, researchPrompt, storyboardSchema, verifyPrompt } from "./prompts";
import { cutout, parseSam } from "./sam";
import { drawLines } from "./portrait";
import { ROOT } from "./root";

export { ROOT };
export const storyDir = (slug: string) => join(ROOT, "stories", slug);
const storyFile = (slug: string) => join(storyDir(slug), "story.json");
/** Public URL and file path of a scene asset. */
export const asset = (slug: string, id: string, name: string) => ({ url: `/stories/${slug}/${id}/${name}`, file: join(ROOT, "public/stories", slug, id, name) });

export type Stage = "research" | "storyboard" | "verify" | "illustrate" | "segment" | "line" | "films" | "frontispiece";

export interface StageEvent {
  stage: Stage;
  scene?: string;
  kind: "info" | "warn" | "error" | "facts" | "board" | "plate" | "refused" | "cut" | "background" | "line";
  message: string;
  /** The asset that just landed, when there is one. */
  url?: string;
  /** Which Meta model made it. */
  model?: string;
  data?: unknown;
}
export type OnEvent = (e: StageEvent) => void;
export const print: OnEvent = (e) => console.log(`  ${e.scene ? `${e.scene}: ` : ""}${e.message}`);

export interface StageOptions {
  /** Only these scene ids; named scenes are redone even if they already have art. */
  only?: string[];
  on?: OnEvent;
  /** Scenes worked on at once (plates after the first, cut-outs). */
  parallel?: number;
}

export interface Fact {
  n: number;
  year: string;
  text: string;
  sources: { label: string; url: string }[];
}

/** "YYYY | fact" lines plus span citations → numbered facts, each with the citations overlapping its line. */
export function factsFromCited(c: Cited): Fact[] {
  const facts: Fact[] = [];
  let pos = 0;
  for (const line of c.text.split("\n")) {
    const start = pos;
    pos += line.length + 1;
    const m = line.match(/^\s*(?:[-*]|\d+\.)?\s*\**(\d{4})\**\s*\|\s*(.+)$/);
    if (!m) continue;
    const sources = c.citations
      .filter((a) => a.start < pos && a.end > start)
      .map((a) => ({ label: a.title.slice(0, 60), url: a.url }))
      .filter((s, i, all) => all.findIndex((x) => x.url === s.url) === i);
    facts.push({ n: facts.length + 1, year: m[1], text: m[2].replace(/\s*\[\d+\]/g, "").replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, "").trim(), sources });
  }
  return facts.filter((f) => f.sources.length > 0).map((f, i) => ({ ...f, n: i + 1 }));
}

/** Run `fn` over items, at most `n` at a time; resolves when all have settled, rethrowing the first failure. */
export async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  const queue = [...items];
  let failed: unknown;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(n, queue.length)) }, async () => {
      while (queue.length && failed === undefined) {
        try {
          await fn(queue.shift()!);
        } catch (e) {
          failed ??= e;
        }
      }
    }),
  );
  if (failed !== undefined) throw failed;
}

export const isRefusal = (e: unknown) => /content[_ ]?policy|safety system|moderation|refus|not allowed/i.test(String((e as Error)?.message ?? e));

export async function research(slug: string, name: string, hint: string, on: OnEvent = print) {
  on({ stage: "research", kind: "info", model: MODELS.spark, message: `searching the web for ${name}` });
  const cited = await sparkSearch(researchPrompt(name, hint));
  await mkdir(storyDir(slug), { recursive: true });
  // Keep the paid answer before parsing it, so a format surprise can be re-parsed for free.
  await writeFile(join(storyDir(slug), "research.raw.json"), JSON.stringify(cited, null, 2));
  const facts = factsFromCited(cited);
  if (facts.length < 7) throw new Error(`only ${facts.length} cited facts for ${name}; refusing to storyboard thin research`);
  await writeFile(join(storyDir(slug), "research.json"), JSON.stringify({ name, hint, facts }, null, 2));
  on({ stage: "research", kind: "facts", model: MODELS.spark, message: `${facts.length} cited facts`, data: facts });
  return facts;
}

/** Trim a caption to the schema's word limit at a sentence end when possible. */
export function fitCaption(caption: string, max = 30): string {
  const words = caption.trim().split(/\s+/);
  if (words.length <= max) return caption.trim();
  const cut = words.slice(0, max).join(" ");
  const end = cut.lastIndexOf(". ");
  return end > 40 ? cut.slice(0, end + 1) : `${cut.replace(/[,;:]$/, "")}…`;
}

export interface Emblem {
  visual: string;
  concept: string;
}

/** `listed: false` writes the life off the shelf (a draft); /create passes `listed: true`. A rerun keeps the life's current setting. */
export async function storyboard(slug: string, on: OnEvent = print, opts: { listed?: boolean } = {}): Promise<StoryT> {
  const before = existsSync(storyFile(slug)) ? await loadStory(slug) : undefined;
  const listed = before ? before.listed : opts.listed;
  const r = JSON.parse(await readFile(join(storyDir(slug), "research.json"), "utf8"));
  const facts: Fact[] = r.facts;
  on({ stage: "storyboard", kind: "info", model: MODELS.spark, message: `writing 7 scenes from ${facts.length} facts` });
  const board = await sparkJson<any>(STORYBOARD_SYSTEM, `Person: ${r.name} (${r.hint})\nFacts:\n${facts.map((f) => `${f.n}. ${f.year} | ${f.text}`).join("\n")}`, "storyboard", storyboardSchema);
  const years = facts.map((f) => Number(f.year));
  const year4 = (y: unknown) => String(y ?? "").match(/\d{4}/)?.[0];
  const scenes = board.scenes.map((s: any, i: number) => {
    // Sources come from the cited facts, never from the storyboard model's own claims.
    let sources = (s.facts as number[]).flatMap((n) => facts.find((f) => f.n === n)?.sources ?? []);
    const year = year4(s.year) ?? facts.find((f) => (s.facts as number[]).includes(f.n))?.year ?? String(years[0]);
    // A scene whose fact numbers don't resolve borrows the sources of the facts from its year.
    if (!sources.length) sources = facts.filter((f) => f.year === year).flatMap((f) => f.sources);
    return {
      id: `s${i + 1}`,
      treatment: s.treatment,
      year,
      title: s.title,
      caption: fitCaption(s.caption),
      visual: s.visual,
      cut: (s.cut as string[]).slice(0, 2),
      sources: sources.filter((x, j, all) => all.findIndex((y) => y.url === x.url) === j).slice(0, 4),
    };
  });
  scenes.sort((a: Scene, b: Scene) => Number(a.year) - Number(b.year));
  scenes.forEach((s: Scene, i: number) => (s.id = `s${i + 1}`));
  const story = Story.parse({
    slug,
    name: r.name,
    born: year4(board.born) ?? String(Math.min(...years)),
    died: year4(board.died) ?? null,
    tagline: board.tagline,
    ...(listed === false ? { listed: false } : {}),
    scenes,
  });
  if (board.emblem) await writeFile(join(storyDir(slug), "emblem.json"), JSON.stringify(board.emblem satisfies Emblem, null, 2));
  await edit(slug, () => story, { create: true });
  on({ stage: "storyboard", kind: "board", model: MODELS.spark, message: `7 scenes, ${story.born}–${story.died ?? "today"}`, data: story });
  return story;
}

/** "OK | reason" / "WRONG | reason" → the stored verdict; anything else counts as disputed. */
export function parseVerdict(text: string): { verdict: "ok" | "disputed"; note: string } {
  // Muse Spark sometimes narrates its search before the verdict, on the same line: take the last "OK |" / "WRONG |".
  const all = [...text.matchAll(/(?:^|[^A-Za-z])(OK|WRONG)\**\s*[|:]\s*([^\n]*)/gi)];
  const m = all.at(-1);
  return { verdict: m?.[1].toUpperCase() === "OK" ? "ok" : "disputed", note: (m ? m[2] : text).trim().slice(0, 400) };
}

/**
 * Muse Spark re-checks every caption against the web (three scenes at a time); the report goes to
 * stories/<slug>/verify.json and each scene's `checked`. Returns the scenes it disputes.
 */
export async function verify(slug: string, on: OnEvent = print, { only, parallel = 3 }: StageOptions = {}) {
  const story = await loadStory(slug);
  const todo = story.scenes.filter((s) => !only || only.includes(s.id));
  const report: { id: string; year: string; caption: string; model: string; at: string; verdict: string; reason: string; raw: string; sources: string[] }[] = [];
  await pool(todo, parallel, async (scene) => {
    const r = await sparkSearch(verifyPrompt(story.name, scene));
    const raw = r.text.trim();
    const v = parseVerdict(raw);
    const row = { id: scene.id, year: scene.year, caption: scene.caption, model: MODELS.spark, at: new Date().toISOString(), verdict: v.verdict, reason: v.note, raw, sources: [...new Set(r.citations.map((c) => c.url))] };
    report.push(row);
    await edit(slug, (s) => void (sceneOf(s, scene.id).checked = { model: row.model, verdict: v.verdict, at: row.at, note: v.note, sources: row.sources }));
    on({ stage: "verify", scene: scene.id, kind: "info", model: MODELS.spark, message: `${v.verdict.toUpperCase()} | ${v.note}` });
  });
  report.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  const file = join(storyDir(slug), "verify.json");
  // A partial rerun (--scenes) keeps the other scenes' rows.
  const old: typeof report = only && existsSync(file) ? JSON.parse(await readFile(file, "utf8")).filter((r: { id: string }) => !only.includes(r.id)) : [];
  const all = [...old, ...report].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  await writeFile(file, JSON.stringify(all, null, 2) + "\n");
  return report.filter((r) => r.verdict !== "ok");
}

const sceneOf = (story: StoryT, id: string) => {
  const s = story.scenes.find((x) => x.id === id);
  if (!s) throw new Error(`${story.slug} has no scene ${id}`);
  return s;
};
const ids = (story: StoryT, only?: string[]) => story.scenes.map((s) => s.id).filter((id) => !only || only.includes(id));

/**
 * One Muse Image plate. Returns false if Muse Image refused the scene (the others carry on;
 * reword its `visual` and rerun it with --scenes). `force` redraws a plate that exists.
 */
export async function illustrateScene(slug: string, id: string, on: OnEvent = print, force = false): Promise<boolean> {
  const story = await loadStory(slug);
  const scene = sceneOf(story, id);
  const done = asset(slug, id, "plate.png");
  const web = asset(slug, id, "plate.webp");
  if (!force && existsSync(done.file)) {
    if (!scene.plate) await edit(slug, (s) => void (sceneOf(s, id).plate = web.url));
    on({ stage: "illustrate", scene: id, kind: "plate", model: MODELS.image, message: "plate already drawn", url: web.url });
    return true;
  }
  // The story's first plate is the style reference for the rest, so the series reads as one hand.
  const first = asset(slug, story.scenes[0].id, "plate.png");
  const refs = id !== story.scenes[0].id && existsSync(first.file) ? [await readFile(first.file)] : [];
  on({ stage: "illustrate", scene: id, kind: "info", model: MODELS.image, message: `painting ${scene.year}, ${eraFor(scene.year).label.toLowerCase()} style${refs.length ? ", plate 1 as reference" : ""}` });
  let png: Buffer;
  try {
    png = await museImage(platePrompt(scene, eraFor(scene.year)), refs);
  } catch (e) {
    if (!isRefusal(e)) throw e;
    on({ stage: "illustrate", scene: id, kind: "refused", model: MODELS.image, message: "Muse Image declined this scene under its content policy; skipped" });
    return false;
  }
  await mkdir(join(done.file, ".."), { recursive: true });
  await writeFile(done.file, png);
  await sharp(png).resize(1400, 1400, { fit: "inside" }).webp({ quality: 82 }).toFile(web.file);
  // Saved after every plate so a dropped connection doesn't lose the ones already paid for.
  await edit(slug, (s) => void (sceneOf(s, id).plate = web.url));
  on({ stage: "illustrate", scene: id, kind: "plate", model: MODELS.image, message: "plate", url: web.url });
  return true;
}

export async function illustrate(slug: string, { only, on = print, parallel = 1 }: StageOptions = {}) {
  const story = await loadStory(slug);
  const todo = ids(story, only);
  const force = Boolean(only);
  // Plate 1 first: it is the style reference for every other plate.
  if (todo[0] === story.scenes[0].id) await illustrateScene(slug, todo.shift()!, on, force);
  await pool(todo, parallel, (id) => illustrateScene(slug, id, on, force));
}

/** SAM 3.1 cut-outs for each `cut` concept on one plate, then a clean background from Muse Image edit. */
export async function segmentScene(slug: string, id: string, on: OnEvent = print, force = false) {
  const story = await loadStory(slug);
  const scene = sceneOf(story, id);
  const platePng = asset(slug, id, "plate.png").file;
  if (!existsSync(platePng)) {
    on({ stage: "segment", scene: id, kind: "warn", message: "no plate, so nothing to cut" });
    return;
  }
  const plate = await readFile(platePng);
  // Resume: cut-outs already made are kept (only a missing clean background is retried).
  const kept = !force && scene.layers.some((l) => l.src);
  const cuts: Layer[] = kept ? scene.layers.filter((l) => l.src) : [];
  for (const [k, concept] of (kept ? [] : scene.cut).entries()) {
    // Storyboard nouns can be too specific for SAM ("tall swimmer"); fall back to the head noun, then "person".
    let masks: Awaited<ReturnType<typeof parseSam>> = [];
    let found = concept;
    for (const c of [...new Set([concept, concept.split(" ").at(-1)!, "person"])]) {
      on({ stage: "segment", scene: id, kind: "info", model: MODELS.sam, message: `looking for “${c}”` });
      masks = await parseSam(await samRaw(plate, c));
      if (masks.length) {
        found = c;
        break;
      }
      on({ stage: "segment", scene: id, kind: "warn", model: MODELS.sam, message: `found no “${c}”` });
    }
    if (!masks.length) continue;
    const best = masks.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
    const cut = await cutout(plate, best);
    const out = asset(slug, id, `cut-${k + 1}.webp`);
    await sharp(cut.png).webp({ quality: 85, alphaQuality: 90 }).toFile(out.file);
    const layer = { id: `cut-${k + 1}`, concept, depth: 0.6 + k * 0.2, src: out.url, x: cut.x, y: cut.y, w: cut.w };
    cuts.push(layer);
    on({ stage: "segment", scene: id, kind: "cut", model: MODELS.sam, message: `cut out “${found}”${best.confidence != null ? ` (${Math.round(best.confidence * 100)}% sure)` : ""}`, url: out.url, data: layer });
  }
  if (!kept)
    await edit(slug, (s) => {
      const sc = sceneOf(s, id);
      sc.layers = [...cuts, ...sc.layers.filter((l) => l.overlay)];
    });
  // The clean plate is a paid edit and doesn't depend on the cut-outs: keep one that exists.
  const bg = asset(slug, id, "background.webp");
  if (cuts.length && (force || !existsSync(bg.file))) {
    on({ stage: "segment", scene: id, kind: "info", model: MODELS.image, message: `painting out the ${scene.cut.join(" and ")}` });
    try {
      const clean = await museEdit(plate, cleanPlatePrompt(scene));
      await sharp(clean).resize(1400, 1400, { fit: "inside" }).webp({ quality: 82 }).toFile(bg.file);
      await edit(slug, (s) => void (sceneOf(s, id).background = bg.url));
      on({ stage: "segment", scene: id, kind: "background", model: MODELS.image, message: "clean background", url: bg.url });
    } catch (e) {
      // Without a clean plate the film is a push-in on the plate alone; still fine.
      on({ stage: "segment", scene: id, kind: isRefusal(e) ? "refused" : "warn", model: MODELS.image, message: `no clean background (${String((e as Error)?.message ?? e).replace(/^[^{]*/, "").slice(0, 100)})` });
    }
  } else if (existsSync(bg.file) && !scene.background) await edit(slug, (s) => void (sceneOf(s, id).background = bg.url));
}

export async function segment(slug: string, { only, on = print, parallel = 1 }: StageOptions = {}) {
  const story = await loadStory(slug);
  await pool(ids(story, only), parallel, (id) => segmentScene(slug, id, on, Boolean(only)));
}

/** A pen-plotter line drawing traced from the plate (line-treatment scenes only). */
export async function lineScene(slug: string, id: string, on: OnEvent = print) {
  const scene = sceneOf(await loadStory(slug), id);
  const plate = asset(slug, id, "plate.png").file;
  if (scene.treatment !== "line" || !existsSync(plate)) return;
  const { width, height } = await sharp(plate).metadata();
  const strokes = await drawLines(await sharp(plate).resize({ width: 1024 }).png().toBuffer());
  const out = asset(slug, id, "line.json");
  await writeFile(out.file, JSON.stringify({ aspect: +(height! / width!).toFixed(4), strokes }));
  await edit(slug, (s) => void (sceneOf(s, id).line = out.url));
  on({ stage: "line", scene: id, kind: "line", message: `traced in ${strokes.length} strokes`, url: out.url });
}

export async function line(slug: string, { only, on = print }: StageOptions = {}) {
  for (const id of ids(await loadStory(slug), only)) await lineScene(slug, id, on);
}

export async function loadStory(slug: string): Promise<StoryT> {
  return Story.parse(JSON.parse(await readFile(storyFile(slug), "utf8")));
}

/** Write atomically: readers at request time never see half a file. */
async function swapIn(file: string, text: string) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}

export async function writeStory(story: StoryT) {
  await mkdir(storyDir(story.slug), { recursive: true });
  await swapIn(storyFile(story.slug), JSON.stringify(Story.parse(story), null, 2) + "\n");
}

const queues = new Map<string, Promise<unknown>>();
/**
 * Read-modify-write story.json, one edit at a time per story in this process. `fn` mutates the
 * fresh copy (or returns a replacement); with `create`, a missing file starts from what it returns.
 */
export function edit(slug: string, fn: (story: StoryT) => StoryT | void, { create = false } = {}): Promise<StoryT> {
  const run = async () => {
    const fresh = existsSync(storyFile(slug)) ? await loadStory(slug) : create ? (undefined as unknown as StoryT) : await loadStory(slug);
    const next = fn(fresh) ?? fresh;
    await writeStory(next);
    return next;
  };
  const p = (queues.get(slug) ?? Promise.resolve()).then(run, run);
  queues.set(slug, p.catch(() => {}));
  return p;
}
