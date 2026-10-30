/**
 * Transcript → dated facts, each resting on a verbatim quote and the moment in the recording it
 * was said. One Muse Spark json_schema call proposes them; code keeps only facts whose quote
 * really is in the transcript (so a citation can never point at words nobody said), and takes the
 * timestamp from the matched turn, never from the model.
 */
import { sparkJson } from "../meta";
import { clock } from "./audio";
import type { FamilyFact, FamilyTurn } from "./types";

export const FACTS_SYSTEM = `You turn a transcribed family oral history into dated facts for a short illustrated biography.
The transcript is a list of numbered turns: [turn number | start time | speaker] text. Speaker labels come from automatic diarization and may be missing or imperfect.
Rules:
- subject_speaker: the label of the person whose life it is (the one telling their own story), or "" if unclear.
- Facts are about the subject's own life, as they tell it: origins, homes, work, marriage, children and grandchildren, turning points, what they do now. Never invent or add outside knowledge.
- Each fact has a year. If the speaker hedges ("maybe 1938", "around 1947") or the year is worked out from an age or another date ("when I was fourteen"), set approx true and begin the text with "About <year>,".
- text: one plain third-person sentence in simple past tense, under 25 words, naming the subject as given.
- turn: the number of the turn where it is said. quote: 4 to 18 words copied exactly, character for character, from that turn's text, which support the fact. Do not fix the transcript's spelling inside the quote.
- The transcript was made by speech recognition and may mishear words. If a word in the text is clearly a mishearing, describe it plainly ("a noodle stall") rather than repeating nonsense; never guess a name or place that isn't in the transcript.
- 8 to 16 facts, in chronological order. Keep politics, war, occupation and violence out: mention them only in passing, never as a fact of their own.
- born: the subject's birth year if stated or worked out, else "". born_approx: true if hedged.`;

export const factsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["subject_speaker", "born", "born_approx", "facts"],
  properties: {
    subject_speaker: { type: "string" },
    born: { type: "string" },
    born_approx: { type: "boolean" },
    facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["year", "approx", "text", "turn", "quote"],
        properties: {
          year: { type: "string" },
          approx: { type: "boolean" },
          text: { type: "string" },
          turn: { type: "integer" },
          quote: { type: "string" },
        },
      },
    },
  },
};

export interface RawFacts {
  subject_speaker: string;
  born: string;
  born_approx: boolean;
  facts: { year: string; approx: boolean; text: string; turn: number; quote: string }[];
}

/** One transcript turn as the model reads it. */
export const turnLine = (t: FamilyTurn) => `[${t.n} | ${t.startMs >= 0 ? clock(t.startMs / 1000) : `line ${t.n}`} | ${t.speaker ?? "?"}] ${t.text}`;

export const factsPrompt = (name: string, hint: string, turns: FamilyTurn[]) =>
  `Subject: ${name}${hint ? ` (${hint})` : ""}\nTranscript:\n${turns.map(turnLine).join("\n")}`;

/** Lower case, letters and digits only, single spaces: how a quote is matched against a turn. */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’‘`]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim();

/** The turn that holds a quote: the one the model named if it's there, else the first that does. */
export function findQuote(quote: string, turns: FamilyTurn[], hint?: number): FamilyTurn | undefined {
  const q = norm(quote);
  if (q.split(" ").length < 3) return undefined;
  const named = turns.find((t) => t.n === hint);
  if (named && norm(named.text).includes(q)) return named;
  return turns.find((t) => norm(t.text).includes(q));
}

/** A quote cut to about `max` characters at a word boundary, for a citation label. */
export function shortQuote(quote: string, max = 64): string {
  const q = quote.trim().replace(/\s+/g, " ").replace(/[.,;:]+$/, "");
  if (q.length <= max) return q;
  const cut = q.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 20 ? cut.lastIndexOf(" ") : max).replace(/[,;:]$/, "")}…`;
}

/** "Recording, 1:23 — “we moved to Tiong Bahru in 1958”" (or "Transcript, line 12 — …" when untimed). */
export function citationLabel(turn: FamilyTurn, quote: string, prefix = "Recording"): string {
  const where = turn.startMs >= 0 ? `${prefix}, ${clock(turn.startMs / 1000)}` : `${prefix} transcript, line ${turn.n}`;
  return `${where} — “${shortQuote(quote)}”`;
}

/** The URL a citation opens: the book's recording page, at the second the turn starts. */
export function citationUrl(origin: string, slug: string, turn: FamilyTurn): string {
  const base = `${origin.replace(/\/$/, "")}/family/${slug}/audio`;
  return turn.startMs >= 0 ? `${base}#t=${Math.floor(turn.startMs / 1000)}` : `${base}#line=${turn.n}`;
}

/** Lower-case a sentence's first word only when it isn't a name ("She moved" → "she moved"; "Ah Ma moved" stays). */
const lowerFirst = (t: string) => (/^(She|He|They|The|A|An|Her|His|Their|In|At|On)\b/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);

export interface CheckedFacts {
  facts: FamilyFact[];
  /** Proposed facts dropped, and why. */
  dropped: { text: string; why: string }[];
  subject?: string;
  born?: string;
}

/**
 * Keep the model's facts that hold up: a four-digit year in a sane range and a quote that is
 * really in the transcript. Each kept fact is cited to its turn's start time.
 */
export function checkFacts(raw: RawFacts, turns: FamilyTurn[], o: { origin: string; slug: string; prefix?: string; now?: number }): CheckedFacts {
  const now = o.now ?? new Date().getFullYear();
  const dropped: CheckedFacts["dropped"] = [];
  const kept: Omit<FamilyFact, "n">[] = [];
  for (const f of raw.facts ?? []) {
    const year = String(f.year ?? "").match(/\d{4}/)?.[0];
    if (!year || Number(year) < 1850 || Number(year) > now) {
      dropped.push({ text: f.text, why: `no usable year (${f.year})` });
      continue;
    }
    const turn = findQuote(f.quote ?? "", turns, f.turn);
    if (!turn) {
      dropped.push({ text: f.text, why: "its quote isn't in the transcript" });
      continue;
    }
    let text = String(f.text ?? "").trim().replace(/\s+/g, " ");
    if (!text) continue;
    if (f.approx && !/^about\b/i.test(text)) text = `About ${year}, ${lowerFirst(text)}`;
    kept.push({
      year,
      approx: Boolean(f.approx),
      text,
      quote: f.quote.trim(),
      turn: turn.n,
      t: turn.startMs >= 0 ? Math.floor(turn.startMs / 1000) : -1,
      source: { label: citationLabel(turn, f.quote, o.prefix), url: citationUrl(o.origin, o.slug, turn) },
    });
  }
  kept.sort((a, b) => Number(a.year) - Number(b.year) || a.t - b.t);
  const born = String(raw.born ?? "").match(/\d{4}/)?.[0];
  return { facts: kept.map((f, i) => ({ n: i + 1, ...f })), dropped, subject: raw.subject_speaker || undefined, born };
}

/** The research.json the storyboard stage reads: numbered facts, each with its one citation. */
export const asResearch = (name: string, hint: string, facts: FamilyFact[]) => ({
  name,
  hint,
  facts: facts.map((f) => ({ n: f.n, year: f.year, text: f.text, sources: [f.source] })),
});

/** Muse Spark proposes the facts; code checks every quote. */
export async function extractFacts(name: string, hint: string, turns: FamilyTurn[], o: { origin: string; slug: string; prefix?: string }) {
  const raw = await sparkJson<RawFacts>(FACTS_SYSTEM, factsPrompt(name, hint, turns), "family_facts", factsSchema);
  return { raw, ...checkFacts(raw, turns, o) };
}
