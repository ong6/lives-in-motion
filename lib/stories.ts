import "server-only";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Story } from "./schema";

const DIR = join(process.cwd(), "stories");
/** Gallery order; anything else follows alphabetically. */
const ORDER = ["jack-sim", "joseph-schooling", "tan-howe-liang"];

/** On the shelf: absent `listed` means yes. */
export const isListed = (story: Story) => story.listed !== false;

function read(slug: string): Story | undefined {
  const f = join(DIR, slug, "story.json");
  // A life being made on /create has a folder (job.json, research) before it has a story.json.
  if (!/^[a-z0-9-]+$/.test(slug) || !existsSync(f)) return undefined;
  return Story.parse(JSON.parse(readFileSync(f, "utf8")));
}

/** Every life with a story.json, listed or not (drafts, withdrawn lives), in gallery order. */
export function everyStory(): Story[] {
  return readdirSync(DIR)
    .map(read)
    .filter((s): s is Story => Boolean(s))
    .sort((a, b) => rank(a.slug) - rank(b.slug) || a.slug.localeCompare(b.slug));
}

/** The shelf: listed lives only, in order. Parts, numbering and the next-life page turn follow it. */
export function allStories(): Story[] {
  return everyStory().filter(isListed);
}

const rank = (slug: string) => (ORDER.includes(slug) ? ORDER.indexOf(slug) : ORDER.length);

/** One life by slug, listed or not: a direct URL opens a draft. */
export function getStory(slug: string): Story | undefined {
  return read(slug);
}

/**
 * What a book page needs to place a life: the chain of Parts it is read in and its index there.
 * A listed life sits in the shelf's chain; an unlisted one is read alone after the shelf (its own
 * Part, no next-life turn), so drafts open by URL without joining the chain.
 */
export function readingOrder(slug: string): { stories: Story[]; part: number } | undefined {
  const shelf = allStories();
  const part = shelf.findIndex((s) => s.slug === slug);
  if (part >= 0) return { stories: shelf, part };
  const draft = getStory(slug);
  return draft ? { stories: [...shelf, draft], part: shelf.length } : undefined;
}

export function lifespan(story: Story): string {
  return story.died ? `${story.born}–${story.died.slice(0, 4)}` : `b. ${story.born}`;
}
