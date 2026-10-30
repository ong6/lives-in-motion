import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Credit {
  page: string;
  license: string;
  artist: string;
}

const credits: Record<string, Credit> = JSON.parse(readFileSync(join(process.cwd(), "pipeline/portraits/credits.json"), "utf8"));

/** One-line credit for a traced portrait; share-alike licences carry over to the drawing. */
export function portraitCredit(slug: string): string {
  const c = credits[slug];
  if (!c) return "";
  const terms = c.license.includes("SA") ? ` Drawing shared under ${c.license}.` : "";
  return `Traced from a photo by ${c.artist} (${c.license}).${terms}`;
}

export const portraitSrc = (slug: string) => `/lines/${slug}.json`;
