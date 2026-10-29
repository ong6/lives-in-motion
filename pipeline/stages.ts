import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { Story, type Story as StoryT, type Layer } from "../src/schema";
import { eraFor } from "../src/eras";
import { museImage, samRaw, sparkJson, sparkSearch, type Cited } from "./meta";
import { STORYBOARD_SYSTEM, platePrompt, researchPrompt, storyboardSchema } from "./prompts";
import { cutout, parseSam } from "./sam";

export const ROOT = new URL("..", import.meta.url).pathname;
export const storyDir = (slug: string) => join(ROOT, "stories", slug);
export const assetDir = (slug: string) => join(ROOT, "public", "stories", slug);

export interface Fact {
  n: number;
  year: string;
  text: string;
  sources: { label: string; url: string }[];
}

/** Turn "YYYY | fact" lines plus span citations into numbered facts with their own sources. */
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
  return facts.filter((f) => f.sources.length > 0);
}

export async function research(slug: string, name: string, hint: string) {
  const cited = await sparkSearch(researchPrompt(name, hint));
  const facts = factsFromCited(cited);
  if (facts.length < 7) throw new Error(`only ${facts.length} cited facts for ${name}; refusing to storyboard thin research`);
  await mkdir(storyDir(slug), { recursive: true });
  await writeFile(join(storyDir(slug), "research.json"), JSON.stringify({ name, hint, facts, raw: cited }, null, 2));
  return facts;
}

export async function storyboard(slug: string): Promise<StoryT> {
  const r = JSON.parse(await readFile(join(storyDir(slug), "research.json"), "utf8"));
  const facts: Fact[] = r.facts;
  const board = await sparkJson<any>(
    STORYBOARD_SYSTEM,
    `Person: ${r.name} (${r.hint})\nFacts:\n${facts.map((f) => `${f.n}. ${f.year} | ${f.text}`).join("\n")}`,
    "storyboard",
    storyboardSchema,
  );
  const years = facts.map((f) => Number(f.year));
  const story = Story.parse({
    slug,
    name: r.name,
    born: String(Math.min(...years)),
    died: null,
    tagline: board.tagline,
    direction: "paper-theatre",
    generated: false,
    scenes: board.scenes.map((s: any, i: number) => ({
      id: `s${i + 1}`,
      year: s.year,
      title: s.title,
      caption: s.caption,
      visual: s.visual,
      // Sources come from the cited facts, never from the storyboard model's own claims.
      sources: s.facts.flatMap((n: number) => facts.find((f) => f.n === n)?.sources ?? []).slice(0, 4),
      layers: s.layers.map((l: any, k: number) => ({ id: `l${k + 1}`, ...l, depth: Math.min(1, Math.max(0, l.depth)) })),
    })),
  });
  await writeStory(story);
  return story;
}

export async function illustrate(slug: string, only?: string[]) {
  const story = await loadStory(slug);
  let ref: Buffer | undefined;
  for (const scene of story.scenes) {
    const out = join(assetDir(slug), scene.id, "plate.png");
    if (only && !only.includes(scene.id)) {
      if (!ref && existsSync(out)) ref = await readFile(out);
      continue;
    }
    // The first plate is the style reference for the rest, so the series reads as one hand.
    const png = await museImage(platePrompt(scene, eraFor(scene.year)), ref ? [ref] : []);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, png);
    ref ??= png;
    console.log(`  plate ${scene.id} → ${out}`);
  }
}

export async function segment(slug: string) {
  const story = await loadStory(slug);
  for (const scene of story.scenes) {
    const platePath = join(assetDir(slug), scene.id, "plate.png");
    if (!existsSync(platePath)) throw new Error(`no plate for ${scene.id}: run illustrate first`);
    const plate = await readFile(platePath);
    const layers: Layer[] = [
      { id: "plate", concept: "background plate", depth: 0, src: `stories/${slug}/${scene.id}/plate.png`, x: 50, y: 100, w: 100, enter: "fade" },
    ];
    for (const l of scene.layers.filter((l) => l.id !== "plate")) {
      const masks = await parseSam(await samRaw(plate, l.concept));
      if (masks.length === 0) {
        console.log(`  ${scene.id}: SAM found no "${l.concept}"; keeping the motif`);
        layers.push({ ...l, src: undefined });
        continue;
      }
      const best = masks.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
      const cut = await cutout(plate, best);
      const file = `${scene.id}/${l.id}.png`;
      await writeFile(join(assetDir(slug), file), cut.png);
      layers.push({ ...l, src: `stories/${slug}/${file}`, x: cut.x, y: cut.y, w: cut.w });
    }
    scene.layers = layers;
    console.log(`  ${scene.id}: ${layers.length - 1} layers cut`);
  }
  story.generated = true;
  await writeStory(story);
}

export async function loadStory(slug: string): Promise<StoryT> {
  return Story.parse(JSON.parse(await readFile(join(storyDir(slug), "story.json"), "utf8")));
}

export async function writeStory(story: StoryT) {
  await mkdir(storyDir(story.slug), { recursive: true });
  await writeFile(join(storyDir(story.slug), "story.json"), JSON.stringify(Story.parse(story), null, 2) + "\n");
}
