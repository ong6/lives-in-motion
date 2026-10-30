import "server-only";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Story } from "./schema";

const DIR = join(process.cwd(), "stories");
/** Gallery order; anything else follows alphabetically. */
const ORDER = ["jack-sim", "lee-kuan-yew", "joseph-schooling"];

export function allStories(): Story[] {
  return readdirSync(DIR)
    // A life being made on /create has a folder (job.json, research) before it has a story.json.
    .filter((slug) => existsSync(join(DIR, slug, "story.json")))
    .map((slug) => Story.parse(JSON.parse(readFileSync(join(DIR, slug, "story.json"), "utf8"))))
    .sort((a, b) => rank(a.slug) - rank(b.slug) || a.slug.localeCompare(b.slug));
}

const rank = (slug: string) => (ORDER.includes(slug) ? ORDER.indexOf(slug) : ORDER.length);

export function getStory(slug: string): Story | undefined {
  return allStories().find((s) => s.slug === slug);
}

export function lifespan(story: Story): string {
  return story.died ? `${story.born}–${story.died.slice(0, 4)}` : `b. ${story.born}`;
}
