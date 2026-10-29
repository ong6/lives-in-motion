import type { Era } from "../src/eras";
import type { Scene } from "../src/schema";
import { MOTIFS } from "../src/motifs";

export const researchPrompt = (name: string, hint: string) => `Research the life of ${name} (${hint}).
Write 14 to 20 dated facts in chronological order, one per line, each formatted exactly as:
YYYY | one plain sentence of fact
Cover origins, turning points, the work they are known for, recognition, and (if applicable) death and legacy.
Only include facts you found in a source; cite every line. Prefer Singapore's National Library (Infopedia), national newspapers, UN and official bodies over blogs.
Use exact dates and numbers. No opinions, no adjectives of praise.`;

export const STORYBOARD_SYSTEM = `You storyboard animated biographies told in 7 illustrated scenes.
Rules:
- Use only the numbered facts given; every scene cites the fact numbers it uses.
- Captions: plain, 1-2 sentences, at most 30 words. Text narrates; the picture carries the scene.
- visual: describe objects, setting and era details for an illustrator. People appear only as silhouettes or seen from behind. Never describe a face.
- layers: 3 to 5 separable objects in the picture, each a short concrete noun phrase an image segmenter can find ("toilet", "globe", "crowd"). depth 0 = far, 1 = near. x/y/w are percent of a 16:9 stage (x centre, y bottom edge, w width).
- Also give each layer the closest fallback motif from the allowed list.`;

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
        required: ["year", "title", "caption", "visual", "facts", "layers"],
        properties: {
          year: { type: "string" },
          title: { type: "string" },
          caption: { type: "string" },
          visual: { type: "string" },
          facts: { type: "array", items: { type: "integer" } },
          layers: {
            type: "array",
            minItems: 3,
            maxItems: 5,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["concept", "depth", "x", "y", "w", "enter", "motif"],
              properties: {
                concept: { type: "string" },
                depth: { type: "number" },
                x: { type: "number" },
                y: { type: "number" },
                w: { type: "number" },
                enter: { type: "string", enum: ["rise", "slide-left", "slide-right", "drop", "fade", "unfold"] },
                motif: { type: "string", enum: Object.keys(MOTIFS) },
              },
            },
          },
        },
      },
    },
  },
};

/** One plate per scene. Plain separations make SAM's cuts clean; no text keeps it honest. */
export const platePrompt = (scene: Scene, era: Era) => `Illustration for a biography, year ${scene.year}.
Style: ${era.print}. Cut-paper collage look with layered shapes and a soft drop shadow under each piece.
Palette: paper ${era.paper}, ink ${era.ink}, accents ${era.accent} and ${era.accent2}.
Scene: ${scene.visual}
Composition: wide 16:9 stage, plain paper background, objects clearly separated with space between them so each can be cut out: ${scene.layers.map((l) => l.concept).join(", ")}.
People only as dark silhouettes or seen from behind; no faces, no portraits of real people. No text, letters or logos.`;
