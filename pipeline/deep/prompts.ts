import type { ResearchFact, Written } from "./check";
import { BODY_MAX, BODY_MIN } from "./check";

export const WRITE_SYSTEM = `You are the writer of an illustrated biography for adult general readers, told like a story: each chapter is a scene a reader wants to stay in, and each page-turn pulls them on.
You are given numbered, verified research facts about one life (some with a verbatim quote and its speaker), the conflicts between sources, and a draft of 12 chapters by a research editor. Write the final text of each chapter.

Truth:
- Use only the numbered facts. Every name, number, date and event must come from the chapter's own facts; cite every fact you use in "facts". Never invent dialogue, thoughts, weather, feelings or scenes the facts don't give. Fewer facts told well beats every fact listed.
- Where sources conflict, follow the corroborated reading, or phrase around the conflict so the text is true either way. Record each choice in "conflicts" (topic, and the reading the book follows).
- Politics and war stay out entirely: no wars, invasions, occupation, soldiers, elections, parties or politicians, not even as background or metaphor. If a fact is about these, leave it out or phrase around it plainly ("he could not get home for four years").

Craft (this matters as much as truth):
- Open on one concrete moment from the facts: a place, an object, an action, in a sentence that makes the reader see it. Then widen out to how he or she got there and what it led to.
- Tell it as a story, not a list: link each detail to the next with time and cause (that year, by then, so, but, within three years). Vary sentence length. Let small specific details carry feeling; the facts are moving enough.
- Never repeat a fact or restate a sentence in other words. Never pad to reach the length; if the facts are few, tell fewer things more fully.
- Bring a quotation in the way a good feature writer does ("he told CNA in 2019", "he remembers"), never "X said, ..." boilerplate and never "X said it".
- Plain, warm, specific, unshowy. No praise adjectives (legendary, iconic, remarkable, inspiring, tireless and the like), no clichés, no moral at the end.
- The draft is a good guide to tone and to the order of events; you may keep its best sentences, but the chapter is yours.

Each chapter:
- body: ${BODY_MIN} to ${BODY_MAX} words, past tense, third person.
- quote: at most one quotation per chapter, copied character for character from the "quote" of one of the chapter's facts (a contiguous part is fine; never alter words). Put it in the body or the voice line in double quotes. Set "quote" to {fact, text} with the exact text, or null if the chapter quotes no one. Any other words in double quotes must be copied exactly from the chapter's facts.
- voice: one line of at most 18 words, set large as a pull-quote: the chapter's quotation again, or a full sentence in the narrator's voice that holds the chapter's feeling (not a list of nouns).
- age: the person's age at the chapter's moment, from the facts and the birth year (0 for the birth).
- turn: one sentence of at most 16 words for the foot of the page that makes the reader turn to the next chapter without giving it away. For the last chapter, a quiet closing line.
- title: at most 6 words, concrete.
- year: four digits that place the chapter in time; when the facts give only a decade or an approximate date, also set "when" to the printed form ("1960s", "c. 1973"), else "".
- Keep the draft's chapter order, years and treatments.`;

export const writeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["chapters", "conflicts"],
  properties: {
    chapters: {
      type: "array",
      minItems: 12,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["n", "title", "year", "when", "age", "body", "voice", "turn", "quote", "facts"],
        properties: {
          n: { type: "integer" },
          title: { type: "string" },
          year: { type: "string" },
          when: { type: "string" },
          age: { type: ["integer", "null"] },
          body: { type: "string" },
          voice: { type: "string" },
          turn: { type: "string" },
          quote: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["fact", "text"],
            properties: { fact: { type: "integer" }, text: { type: "string" } },
          },
          facts: { type: "array", items: { type: "integer" } },
        },
      },
    },
    conflicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "choice"],
        properties: { topic: { type: "string" }, choice: { type: "string" } },
      },
    },
  },
};

interface DraftChapter {
  n: number;
  year: string;
  title: string;
  treatment: string;
  body: string;
  voice?: string;
  facts: number[];
  photo?: { note?: string } | null;
}

export function writeInput(o: { name: string; born: string; died: string | null; facts: ResearchFact[]; conflicts: { topic: string; detail: string }[]; draft: DraftChapter[]; notes?: Record<number, string> }) {
  const facts = o.facts
    .map((f) => `${f.n}. ${f.year} | ${f.text}${f.quote ? ` | quote (${f.speaker ?? "unknown"}): "${f.quote}"` : ""}${f.corroborated ? " | corroborated" : ""}`)
    .join("\n");
  const conflicts = o.conflicts.map((c) => `- ${c.topic}: ${c.detail}`).join("\n") || "(none)";
  const draft = o.draft
    .map((c) =>
      [
        `Chapter ${c.n} (${c.year}, ${c.treatment}${c.treatment === "photo" ? ": a real photograph faces the text" : ""}): ${c.title}`,
        `facts: ${c.facts.join(", ")}`,
        o.notes?.[c.n] ? `editor's note: ${o.notes[c.n]}` : "",
        `draft: ${c.body}`,
        c.voice ? `draft voice: ${c.voice}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
  return `Person: ${o.name}, born ${o.born}${o.died ? `, died ${o.died}` : ""}.\n\nFacts:\n${facts}\n\nConflicts between sources:\n${conflicts}\n\nDraft chapters:\n${draft}`;
}

export function repairInput(previous: { chapters: Written[]; conflicts: unknown[] }, problems: string[]) {
  return `Your chapters failed these checks:\n${problems.map((p) => `- ${p}`).join("\n")}\n\nReturn all 12 chapters again with these problems fixed and everything else unchanged.\n\nYour previous answer:\n${JSON.stringify(previous)}`;
}

/** Muse Spark re-checks one chapter against its cited sources on the web. */
export const deepVerifyPrompt = (name: string, c: { year: string; title: string; body: string; quote?: { text: string; speaker: string } }, urls: string[]) =>
  `Fact-check this chapter of a biography of ${name} (${c.year}, "${c.title}") using web search. Check names, numbers, dates and events; ignore style.
${c.quote ? `It quotes ${c.quote.speaker}: "${c.quote.text}". Check that the words are theirs.\n` : ""}Chapter: "${c.body}"
Its cited sources: ${urls.join(" ")}
Reply with exactly one line: OK | <short reason>, or WRONG | <what is wrong and the correct fact>. Cite your sources.`;
