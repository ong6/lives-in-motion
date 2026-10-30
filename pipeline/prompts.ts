import type { Era } from "../lib/eras";
import type { Scene } from "../lib/schema";

export const researchPrompt = (name: string, hint: string) => `Research the life of ${name} (${hint}).
Write 14 to 20 dated facts in chronological order, one per line, each formatted exactly as:
YYYY | one plain sentence of fact
Cover origins, turning points, the work they are known for, recognition, and (if applicable) death and legacy.
Only include facts you found in a source; cite every line. Prefer Singapore's National Library (Infopedia), national newspapers, the UN and official bodies over blogs.
Use exact dates and numbers. No opinions, no adjectives of praise.`;

export const verifyPrompt = (name: string, scene: Scene) => `Fact-check this caption about ${name} (${scene.year}) using web search.
Caption: "${scene.caption}"
Reply with exactly one line: OK | <short reason>, or WRONG | <what is wrong and the correct fact>. Cite your sources.`;

export const STORYBOARD_SYSTEM = `You storyboard animated biographies told in 7 illustrated scenes.
Rules:
- Use only the numbered facts given; every scene cites the fact numbers it uses.
- Captions: plain, 1-2 sentences, at most 30 words.
- visual: art direction for a square illustration with one clear subject in the centre. Name concrete objects, setting and period details. People only as silhouettes or seen from behind; never describe a face. No flags, text, logos or numbers in the picture.
- cut: 1-2 short noun phrases for the foreground objects an image segmenter should cut out ("toilet", "boy").
- treatment: "archive" for early or documentary moments, "theatre" for scenes with a strong foreground subject, "line" for quiet, symbolic moments. Mix them.`;

export const storyboardSchema = {
  type: "object",
  additionalProperties: false,
  required: ["tagline", "scenes"],
  properties: {
    tagline: { type: "string" },
    scenes: {
      type: "array",
      minItems: 7,
      maxItems: 7,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["year", "title", "caption", "visual", "cut", "treatment", "facts"],
        properties: {
          year: { type: "string" },
          title: { type: "string" },
          caption: { type: "string" },
          visual: { type: "string" },
          cut: { type: "array", items: { type: "string" }, maxItems: 2 },
          treatment: { type: "string", enum: ["theatre", "archive", "line"] },
          facts: { type: "array", items: { type: "integer" } },
        },
      },
    },
  },
};

/** One square plate per scene, in the era's print technique and palette. */
export const platePrompt = (scene: Scene, era: Era) => `Square illustration for a biography, year ${scene.year}.
Style: ${era.print}. Palette: paper ${era.paper}, ink ${era.ink}, accents ${era.accent} and ${era.accent2}.
Scene: ${scene.visual}
Composition: one clear subject in the centre, uncluttered background, generous negative space; the foreground objects (${scene.cut.join(", ") || "the subject"}) stand apart from the background.
People only as silhouettes or seen from behind; no faces. No text, letters, numbers, flags or logos anywhere.`;

export const cleanPlatePrompt = (scene: Scene) =>
  `Remove the ${scene.cut.join(" and the ")} from this illustration and fill the space with the surrounding background in exactly the same style. Change nothing else.`;
