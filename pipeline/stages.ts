import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { Story, type Layer, type Story as StoryT } from "../lib/schema";
import { eraFor } from "../lib/eras";
import { museEdit, museImage, samRaw, sparkJson, sparkSearch, type Cited } from "./meta";
import { STORYBOARD_SYSTEM, cleanPlatePrompt, platePrompt, researchPrompt, storyboardSchema, verifyPrompt } from "./prompts";
import { cutout, parseSam } from "./sam";
import { lineArt, loadGray } from "./line";

export const ROOT = new URL("..", import.meta.url).pathname;
const storyFile = (slug: string) => join(ROOT, "stories", slug, "story.json");
/** Public URL and file path of a scene asset. */
const asset = (slug: string, id: string, name: string) => ({ url: `/stories/${slug}/${id}/${name}`, file: join(ROOT, "public/stories", slug, id, name) });

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
    const m = line.match(/^\s*[-*]?\s*(\d{4})\s*\|\s*(.+)$/);
    if (!m) continue;
    const sources = c.citations
      .filter((a) => a.start < pos && a.end > start)
      .map((a) => ({ label: a.title.slice(0, 60), url: a.url }))
      .filter((s, i, all) => all.findIndex((x) => x.url === s.url) === i);
    facts.push({ n: facts.length + 1, year: m[1], text: m[2].replace(/\s*\[\d+\]/g, "").trim(), sources });
  }
  return facts.filter((f) => f.sources.length > 0).map((f, i) => ({ ...f, n: i + 1 }));
}

export async function research(slug: string, name: string, hint: string) {
  const cited = await sparkSearch(researchPrompt(name, hint));
  const facts = factsFromCited(cited);
  if (facts.length < 7) throw new Error(`only ${facts.length} cited facts for ${name}; refusing to storyboard thin research`);
  await mkdir(join(ROOT, "stories", slug), { recursive: true });
  await writeFile(join(ROOT, "stories", slug, "research.json"), JSON.stringify({ name, hint, facts }, null, 2));
  return facts;
}

export async function storyboard(slug: string): Promise<StoryT> {
  const r = JSON.parse(await readFile(join(ROOT, "stories", slug, "research.json"), "utf8"));
  const facts: Fact[] = r.facts;
  const board = await sparkJson<any>(STORYBOARD_SYSTEM, `Person: ${r.name} (${r.hint})\nFacts:\n${facts.map((f) => `${f.n}. ${f.year} | ${f.text}`).join("\n")}`, "storyboard", storyboardSchema);
  const story = Story.parse({
    slug,
    name: r.name,
    born: String(Math.min(...facts.map((f) => Number(f.year)))),
    died: null,
    tagline: board.tagline,
    scenes: board.scenes.map((s: any, i: number) => ({
      id: `s${i + 1}`,
      treatment: s.treatment,
      year: s.year,
      title: s.title,
      caption: s.caption,
      visual: s.visual,
      cut: s.cut,
      // Sources come from the cited facts, never from the storyboard model's own claims.
      sources: s.facts.flatMap((n: number) => facts.find((f) => f.n === n)?.sources ?? []).slice(0, 4),
    })),
  });
  await writeStory(story);
  return story;
}

/** Muse Spark re-checks every caption against the web; returns the scenes it disputes. */
export async function verify(slug: string) {
  const story = await loadStory(slug);
  const report: { id: string; year: string; verdict: string; sources: string[] }[] = [];
  for (const scene of story.scenes) {
    const r = await sparkSearch(verifyPrompt(story.name, scene));
    report.push({ id: scene.id, year: scene.year, verdict: r.text.trim().split("\n")[0], sources: [...new Set(r.citations.map((c) => c.url))] });
    console.log(`  ${scene.id} ${report.at(-1)!.verdict}`);
  }
  await writeFile(join(ROOT, "stories", slug, "verify.json"), JSON.stringify(report, null, 2));
  return report.filter((r) => !r.verdict.startsWith("OK"));
}

const scenesOf = (story: StoryT, only?: string[]) => story.scenes.filter((s) => !only || only.includes(s.id));

export async function illustrate(slug: string, only?: string[]) {
  const story = await loadStory(slug);
  const first = asset(slug, story.scenes[0].id, "plate.png");
  for (const scene of scenesOf(story, only)) {
    // The story's first plate is the style reference for the rest, so the series reads as one hand.
    const refs = scene.id !== story.scenes[0].id && existsSync(first.file) ? [await readFile(first.file)] : [];
    const png = await museImage(platePrompt(scene, eraFor(scene.year)), refs);
    const plate = asset(slug, scene.id, "plate.png");
    await mkdir(join(plate.file, ".."), { recursive: true });
    await writeFile(plate.file, png);
    const web = asset(slug, scene.id, "plate.webp");
    await sharp(png).resize(1400, 1400, { fit: "inside" }).webp({ quality: 82 }).toFile(web.file);
    scene.plate = web.url;
    console.log(`  ${scene.id} plate`);
  }
  await writeStory(story);
}

/** SAM 3.1 cut-outs for each `cut` concept, then a clean background plate from Muse Image edit. */
export async function segment(slug: string, only?: string[]) {
  const story = await loadStory(slug);
  for (const scene of scenesOf(story, only)) {
    const platePng = asset(slug, scene.id, "plate.png").file;
    if (!existsSync(platePng)) throw new Error(`no plate for ${scene.id}: run illustrate first`);
    const plate = await readFile(platePng);
    const cuts: Layer[] = [];
    for (const [k, concept] of scene.cut.entries()) {
      const masks = await parseSam(await samRaw(plate, concept));
      if (!masks.length) {
        console.log(`  ${scene.id}: SAM found no "${concept}"`);
        continue;
      }
      const best = masks.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
      const cut = await cutout(plate, best);
      const out = asset(slug, scene.id, `cut-${k + 1}.webp`);
      await sharp(cut.png).webp({ quality: 85, alphaQuality: 90 }).toFile(out.file);
      cuts.push({ id: `cut-${k + 1}`, concept, depth: 0.6 + k * 0.2, src: out.url, x: cut.x, y: cut.y, w: cut.w });
    }
    scene.layers = [...cuts, ...scene.layers.filter((l) => l.overlay)];
    if (cuts.length) {
      try {
        const clean = await museEdit(plate, cleanPlatePrompt(scene));
        const bg = asset(slug, scene.id, "background.webp");
        await sharp(clean).resize(1400, 1400, { fit: "inside" }).webp({ quality: 82 }).toFile(bg.file);
        scene.background = bg.url;
      } catch (e) {
        // Without a clean plate the cut-outs move only slightly over their own image; still fine.
        console.log(`  ${scene.id}: no clean plate (${String(e).slice(0, 120)})`);
      }
    }
    console.log(`  ${scene.id}: ${cuts.length} cut-outs`);
  }
  await writeStory(story);
}

/** A Fourier line traced from the plate, for scenes with the line treatment. */
export async function line(slug: string, only?: string[]) {
  const story = await loadStory(slug);
  for (const scene of scenesOf(story, only).filter((s) => s.treatment === "line")) {
    const plate = asset(slug, scene.id, "plate.png").file;
    if (!existsSync(plate)) continue;
    const art = lineArt(await loadGray(plate, 360, 2), { levels: [70, 125, 180], minPoints: 40, keep: 1200 });
    const out = asset(slug, scene.id, "line.json");
    await writeFile(out.file, JSON.stringify(art));
    scene.line = out.url;
    console.log(`  ${scene.id}: line with ${art.terms.length} terms`);
  }
  await writeStory(story);
}

export async function loadStory(slug: string): Promise<StoryT> {
  return Story.parse(JSON.parse(await readFile(storyFile(slug), "utf8")));
}

export async function writeStory(story: StoryT) {
  await mkdir(join(ROOT, "stories", story.slug), { recursive: true });
  await writeFile(storyFile(story.slug), JSON.stringify(Story.parse(story), null, 2) + "\n");
}
