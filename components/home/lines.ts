import type { Story } from "@/lib/schema";
import { plan, roman } from "@/components/book/pagination";

/**
 * What the home page quotes from the books: lines to open a book on, dated days to set beside
 * today, and the shelf's sections. Pure functions over the story files (and the research agent's
 * `deep/` notes, read by `homeData.ts`), so the page never invents a word.
 */

/** The shelf's sections, by theme. A life not listed here (a new one from /create) goes under "New on the shelf". */
export const GROUPS: { id: string; name: string; slugs: string[] }[] = [
  { id: "builders", name: "Builders", slugs: ["jack-sim", "sim-wong-hoo", "lee-kong-chian"] },
  { id: "athletes", name: "Athletes", slugs: ["joseph-schooling", "tan-howe-liang", "c-kunalan"] },
  { id: "carers", name: "Artists & carers", slugs: ["georgette-chen", "teresa-hsu"] },
];
export const NEW_GROUP = { id: "new", name: "New on the shelf" };

/** The lives in shelf sections, keeping the shelf's order inside each; empty sections are dropped. */
export function grouped<T extends { slug: string }>(lives: T[]): { id: string; name: string; lives: T[] }[] {
  const known = new Set(GROUPS.flatMap((g) => g.slugs));
  return [
    ...GROUPS.map((g) => ({ id: g.id, name: g.name, lives: lives.filter((l) => g.slugs.includes(l.slug)) })),
    { ...NEW_GROUP, lives: lives.filter((l) => !known.has(l.slug)) },
  ].filter((g) => g.lives.length > 0);
}

/** One chapter of the research agent's storyboard (stories/<slug>/deep/storyboard.json), the fields used here. */
export interface DeepChapter {
  year: string;
  title: string;
  voice?: string | null;
  quote?: { text: string; speaker: string } | null;
}

/** A line from a book, with the chapter it opens on. */
export interface Line {
  slug: string;
  name: string;
  /** "Chapter IV" */
  chapter: string;
  year: string;
  title: string;
  text: string;
  /** Who said it, for a quotation; absent for the book's own words. */
  by?: string;
  href: string;
}

/** The URL that opens a book at chapter `j` (0-based), at that chapter's spread in the book's own plan. */
export const chapterHref = (story: Story, j: number) => `/${story.slug}#p=${plan(story).spreadOf[j]}`;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const firstSentence = (s: string) => (/^.+?[.!?](?=\s|$)/.exec(s)?.[0] ?? s).trim();

/** A storyboard voice line: `"Quoted words." (Source, 2019)` splits into words and source; plain prose stays whole. */
export function splitVoice(voice: string): { text: string; by?: string } {
  const m = /^["“](.+?)["”]\s*(?:\((.+)\))?\s*$/.exec(voice.trim());
  return m ? { text: m[1], by: m[2] } : { text: voice.trim() };
}

/**
 * The storyboard chapter a book chapter was written from: the same position when the book
 * follows the storyboard chapter for chapter, else the one with the same title. A chapter
 * with no match gets no storyboard line, so a quote is never set against the wrong chapter.
 */
export function deepFor(story: Story, deep: DeepChapter[] | undefined, j: number): DeepChapter | undefined {
  if (!deep?.length) return undefined;
  const scene = story.scenes[j];
  if (deep.length === story.scenes.length && deep[j].year.includes(scene.year)) return deep[j];
  return deep.find((c) => norm(c.title) === norm(scene.title));
}

/**
 * Every line worth opening a book on: the chapter's own quotation or pull-quote line (a deep
 * edition carries them), else a sourced quotation or human detail from the research where the
 * chapter has one, else the chapter's own first sentence. Quotations come first.
 */
export function linesFor(story: Story, deep?: DeepChapter[]): Line[] {
  const lines = story.scenes.map((scene, j): Line & { rank: number } => {
    const base = { slug: story.slug, name: story.name, chapter: `Chapter ${roman(j + 1)}`, year: scene.when ?? scene.year, title: scene.title, href: chapterHref(story, j) };
    const d: DeepChapter | undefined = scene.quote || scene.voice ? { year: scene.year, title: scene.title, quote: scene.quote, voice: scene.voice } : deepFor(story, deep, j);
    if (d?.quote) return { ...base, text: d.quote.text, by: d.quote.speaker, rank: 0 };
    if (d?.voice) {
      const v = splitVoice(d.voice);
      return { ...base, ...v, rank: v.by ? 0 : 1 };
    }
    return { ...base, text: firstSentence(scene.caption), rank: 2 };
  });
  return lines.sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...l }) => l);
}

/**
 * The lines the shelf's stand turns through: the best few from each book, interleaved so two
 * lines from one life never follow each other, then started at `start` (the page picks it).
 */
export function standLines(perBook: Line[][], each = 3, start = 0): Line[] {
  const out: Line[] = [];
  for (let k = 0; k < each; k++) for (const lines of perBook) if (lines[k]) out.push(lines[k]);
  if (!out.length) return out;
  const s = ((start % out.length) + out.length) % out.length;
  return [...out.slice(s), ...out.slice(0, s)];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DATE = new RegExp(`\\b(\\d{1,2}) (${MONTHS.join("|")}),? (\\d{4})\\b`);

/** A day in a life, from a sentence that names it. */
export interface Dated {
  slug: string;
  name: string;
  day: number;
  /** 0-based */
  month: number;
  year: number;
  text: string;
  href: string;
}

/** The first full date (`19 November 2001`) in a sentence. */
export function parseDate(text: string): { day: number; month: number; year: number; at: number } | undefined {
  const m = DATE.exec(text);
  return m ? { day: Number(m[1]), month: MONTHS.indexOf(m[2]), year: Number(m[3]), at: m.index } : undefined;
}

/** The chapter a year falls in: the last chapter that starts on or before it (the first, for earlier years). */
export function chapterFor(story: Story, year: number): number {
  let j = 0;
  story.scenes.forEach((sc, k) => {
    if (Number(sc.year) <= year) j = k;
  });
  return j;
}

/** Dated sentences from a book's captions and its research, one per day. */
export function datedFor(story: Story, facts: string[] = []): Dated[] {
  const seen = new Set<string>();
  const out: Dated[] = [];
  for (const text of [...story.scenes.map((s) => s.caption), ...facts]) {
    const d = parseDate(text);
    const key = d && `${d.year}-${d.month}-${d.day}`;
    if (!d || seen.has(key!)) continue;
    seen.add(key!);
    // The sentence the date is in.
    const sentence = firstSentence(text.slice(text.lastIndexOf(". ", d.at) + 1));
    out.push({ slug: story.slug, name: story.name, day: d.day, month: d.month, year: d.year, text: sentence, href: chapterHref(story, chapterFor(story, d.year)) });
  }
  return out;
}

/** Days from `today` to the anniversary nearest it, before (negative) or after. */
export function daysFrom(today: Date, month: number, day: number): number {
  const y = today.getUTCFullYear();
  const t = Date.UTC(y, today.getUTCMonth(), today.getUTCDate());
  const ds = [y - 1, y, y + 1].map((yy) => (Date.UTC(yy, month, day) - t) / 86_400_000);
  return ds.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
}

/** The `k` dated days nearest today's date in any year, nearest first, at most one per life. */
export function nearestDays(all: Dated[], today: Date, k = 3): (Dated & { away: number })[] {
  const byLife = new Map<string, Dated & { away: number }>();
  for (const d of all) {
    const away = daysFrom(today, d.month, d.day);
    const cur = byLife.get(d.slug);
    if (!cur || Math.abs(away) < Math.abs(cur.away)) byLife.set(d.slug, { ...d, away });
  }
  return [...byLife.values()].sort((a, b) => Math.abs(a.away) - Math.abs(b.away) || a.away - b.away).slice(0, k);
}

export const monthName = (m: number) => MONTHS[m];
