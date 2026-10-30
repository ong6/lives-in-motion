import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface Credit {
  page: string;
  license: string;
  artist: string;
}

/** Hand-curated photo credits for the original lives. */
const credits: Record<string, Credit> = JSON.parse(readFileSync(join(process.cwd(), "pipeline/portraits/credits.json"), "utf8"));

/**
 * Credit written by /create for a life it made (stories/<slug>/credit.json): the reader's own
 * photo, or a Muse Image emblem. Read at request time, so a new life is credited at once.
 */
function generatedCredit(slug: string): string {
  const f = join(process.cwd(), "stories", slug, "credit.json");
  if (!existsSync(f)) return "";
  try {
    return String(JSON.parse(readFileSync(f, "utf8")).text ?? "");
  } catch {
    return "";
  }
}

/** One-line credit for a life's frontispiece ("" when there is none); share-alike licences carry over to the drawing. */
export function portraitCredit(slug: string): string {
  const c = credits[slug];
  if (!c) return generatedCredit(slug);
  const terms = c.license.includes("SA") ? ` Drawing shared under ${c.license}.` : "";
  return `Traced from a photo by ${c.artist} (${c.license}).${terms}`;
}

/** URL of the life's line-drawing frontispiece, or undefined while it has none (a new life still being made). */
export function portraitSrc(slug: string): string | undefined {
  return existsSync(join(process.cwd(), "public/lines", `${slug}.json`)) ? `/lines/${slug}.json` : undefined;
}
