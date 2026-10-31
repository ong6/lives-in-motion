/**
 * The code-side checks on Muse Spark's chapters (pure, tested in tests/deep.test.ts): quotations
 * are verbatim from the research, sources come only from a chapter's fact numbers, and the shape
 * rules (word counts, one quote, an age, a turn) hold. Problems go back to Spark for a repair.
 */
import type { Source } from "../../lib/schema";

export interface ResearchFact {
  n: number;
  year: string;
  text: string;
  quote?: string;
  speaker?: string;
  sources: Source[];
  corroborated?: boolean;
}

export interface Written {
  n: number;
  title: string;
  /** Four-digit year that places the chapter; `when` is the printed form when it is approximate. */
  year: string;
  when: string;
  age: number | null;
  body: string;
  voice: string;
  turn: string;
  quote: { fact: number; text: string } | null;
  facts: number[];
}

export const BODY_MIN = 90;
export const BODY_MAX = 150;

export const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/** Fold typographic variants so "verbatim" means the same words and punctuation, not the same code points. */
export function fold(t: string): string {
  return t
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/…/g, "...")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Quoted spans in a text ("…" or “…”), at least `min` words long. Apostrophes are not quote marks. */
export function quotedSpans(t: string, min = 3): string[] {
  const out: string[] = [];
  for (const m of t.matchAll(/["“]([^"“”]+)["”]/g)) if (wordCount(m[1]) >= min) out.push(m[1].trim());
  return out;
}

/** A quoted span is verbatim when it appears in the fact's quote (or, for titles and phrases, its text), ignoring a trailing full stop or comma. */
export function verbatimIn(span: string, fact: ResearchFact): "quote" | "text" | null {
  const s = fold(span).replace(/[.,;:!?]+$/, "");
  if (!s) return null;
  if (fact.quote && fold(fact.quote).includes(s)) return "quote";
  if (fold(fact.text).includes(s)) return "text";
  return null;
}

/** Words that praise instead of tell. */
export const PRAISE = /\b(legendary|iconic|visionary|remarkable|incredible|amazing|inspiring|inspirational|extraordinary|tireless|brilliant|genius|heroic|beloved|pioneering|trailblazing|trailblazer|illustrious|celebrated|renowned|unparalleled|unwavering|indomitable|indefatigable|towering|giant of|larger than life|true legend|selfless)\b/i;
/** Politics and war stay out of these books; a fact about them is left out or phrased around. */
export const OFF_LIMITS = /\b(war|wars|wartime|warfare|invasion|invaded|invade|occupation|occupied|occupying|bomb\w*|soldiers?|troops|army|military|internment|interned|prisoners? of war|kempeitai|surrender\w*|election\w*|political|politics|politician\w*|party members?|communis\w*|kuomintang|Lee Kuan Yew|house arrest|under arrest|detained|detention|captiv\w*|interrogat\w*|were held (?:there|and|in)|was held captive)\b/i;

export interface CheckResult {
  problems: string[];
  /** Chapters after the fixes code can make itself (age), ready to assemble. */
  chapters: Written[];
}

/**
 * Check the chapters against the research. `born` is the birth year; `expected` the number of
 * chapters. Code fixes what it can (an age that disagrees with the years); the rest are problems.
 */
export function checkChapters(chapters: Written[], facts: ResearchFact[], born: number, expected: number): CheckResult {
  const problems: string[] = [];
  const byN = new Map(facts.map((f) => [f.n, f]));
  if (chapters.length !== expected) problems.push(`expected ${expected} chapters, got ${chapters.length}`);
  const out = chapters.map((c, i) => {
    const at = `chapter ${c.n ?? i + 1}`;
    const fix = { ...c };
    if (c.n !== i + 1) problems.push(`${at}: chapters must be numbered 1..${expected} in order`);
    if (!/^\d{4}$/.test(c.year)) problems.push(`${at}: year must be four digits ("${c.year}"); put the approximate form in "when"`);
    const w = wordCount(c.body);
    if (w < BODY_MIN || w > BODY_MAX) problems.push(`${at}: body is ${w} words; it must be ${BODY_MIN}-${BODY_MAX}`);
    if (wordCount(c.title) > 8) problems.push(`${at}: title over 8 words`);
    if (wordCount(c.voice) > 30) problems.push(`${at}: voice line over 30 words`);
    if (!c.turn.trim() || wordCount(c.turn) > 22) problems.push(`${at}: turn must be one line of at most 22 words`);
    const unknown = c.facts.filter((n) => !byN.has(n));
    if (unknown.length) problems.push(`${at}: fact numbers ${unknown.join(", ")} are not in the research`);
    if (!c.facts.some((n) => byN.has(n))) problems.push(`${at}: cites no facts`);
    const own = c.facts.map((n) => byN.get(n)).filter((f): f is ResearchFact => Boolean(f));

    // Quotations: verbatim from the chapter's own facts, and at most one spoken quote.
    const spoken = new Set<string>();
    for (const [field, text] of [["body", c.body], ["voice", c.voice], ["turn", c.turn], ["title", c.title]] as const) {
      for (const span of quotedSpans(text)) {
        const hit = own.map((f) => verbatimIn(span, f)).find(Boolean);
        if (!hit) problems.push(`${at}: the ${field} quotes "${span}", which is not verbatim in the quote or text of its facts (${c.facts.join(", ")})`);
        else if (hit === "quote") spoken.add(fold(span).replace(/[.,;:!?]+$/, ""));
      }
    }
    // The voice line may repeat the body's quote as a pull-quote; that is still one quote.
    const distinct = [...spoken].filter((s, _, all) => !all.some((o) => o !== s && o.includes(s)));
    if (distinct.length > 1) problems.push(`${at}: uses ${distinct.length} different quotations; at most one is allowed`);
    if (c.quote) {
      const f = byN.get(c.quote.fact);
      if (!f || !c.facts.includes(c.quote.fact)) problems.push(`${at}: quote cites fact ${c.quote.fact}, which is not one of its facts`);
      else if (verbatimIn(c.quote.text, f) !== "quote") problems.push(`${at}: quote "${c.quote.text}" is not verbatim in fact ${f.n}'s quote`);
      if (!fold(c.body).includes(fold(c.quote.text).replace(/[.,;:!?]+$/, "")) && !fold(c.voice).includes(fold(c.quote.text).replace(/[.,;:!?]+$/, "")))
        problems.push(`${at}: the quote field's text must appear in the body or the voice line`);
    } else if (distinct.length) problems.push(`${at}: quotes "${distinct[0]}" but its quote field is null; set quote.fact and quote.text`);

    const again = repeats(c.body);
    if (again) problems.push(`${at}: the body says the same thing twice ("${again[0]}" / "${again[1]}"); tell each fact once`);
    if (/\bsaid it\.|\b(?:he|she|[A-Z]\w+ [A-Z]\w+) said, "/.test(c.body)) problems.push(`${at}: introduce the quotation as a feature writer would, not with 'X said, "…"'`);
    for (const [field, text] of [["title", c.title], ["body", c.body], ["voice", c.voice], ["turn", c.turn]] as const) {
      const praise = text.match(PRAISE);
      if (praise) problems.push(`${at}: the ${field} uses the praise word "${praise[0]}"; show it instead`);
      const off = text.match(OFF_LIMITS);
      if (off) problems.push(`${at}: the ${field} says "${off[0]}"; keep politics and war out (leave the fact out or phrase around it)`);
    }

    // Age at that moment: from the years when the chapter's year is exact; an approximate year may be a few years on.
    const year = Number(c.year);
    if (Number.isFinite(year) && born) {
      const exact = year - born;
      const ok = c.age != null && (c.when ? c.age >= exact - 2 && c.age <= exact + 10 : Math.abs(c.age - exact) <= 1);
      if (!ok) fix.age = Math.max(0, exact);
    }
    return fix;
  });
  // Turns: each one specific to what comes next, never the same line twice.
  const turns = chapters.map((c) => fold(c.turn).replace(/[^a-z0-9 ]/g, ""));
  turns.forEach((t, i) => {
    if (VAGUE_TURN.test(t)) problems.push(`chapter ${i + 1}: the turn "${chapters[i].turn}" is vague; hint at the next chapter's own place, object or event`);
    const j = turns.findIndex((u, k) => k < i && overlap(t, u) >= 0.6);
    if (j >= 0) problems.push(`chapter ${i + 1}: the turn repeats chapter ${j + 1}'s ("${chapters[j].turn}"); every turn must be different`);
  });
  return { problems, chapters: out };
}

/** A turn that could end any chapter. */
export const VAGUE_TURN = /\b(change|changes|changed|changing|everything|more to come|on its way)\b/;
const overlap = (a: string, b: string) => {
  const A = new Set(a.split(" ").filter((w) => w.length > 3)), B = new Set(b.split(" ").filter((w) => w.length > 3));
  const shared = [...A].filter((w) => B.has(w)).length;
  return shared / Math.max(1, Math.min(A.size, B.size));
};

/** Two sentences that share most of their words: padding, not storytelling. Returns the pair, if any. */
export function repeats(body: string): [string, string] | null {
  // A quotation that echoes the opening is a deliberate rhyme, not padding.
  const sentences = body.split(/(?<=[.!?]["\u201D]?)\s+/).filter((x) => wordCount(x) >= 4 && !/["\u201C]/.test(x));
  const bag = (t: string) => new Set(fold(t).replace(/[^a-z0-9$ ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
  const bags = sentences.map(bag);
  for (let i = 0; i < bags.length; i++)
    for (let j = i + 1; j < bags.length; j++) {
      const a = bags[i], b = bags[j];
      const shared = [...a].filter((w) => b.has(w)).length;
      const r = shared / Math.min(a.size, b.size);
      if ((shared >= 3 && r >= 0.75) || (shared >= 4 && r >= 0.6)) return [sentences[i], sentences[j]];
    }
  return null;
}

/** A chapter's sources: only those of the facts it cites, deduplicated, at most `max`. */
export function sourcesFor(factNs: number[], facts: ResearchFact[], max = 5): Source[] {
  const all = factNs.flatMap((n) => facts.find((f) => f.n === n)?.sources ?? []);
  return all.filter((s, i) => all.findIndex((x) => x.url === s.url) === i).slice(0, max);
}
