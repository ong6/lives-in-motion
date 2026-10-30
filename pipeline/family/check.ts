/**
 * Every caption checked against the recording. The storyboard stage writes captions from the
 * facts, and a storyteller's plain words invite embellishment ("she remembers salt air"). One
 * Muse Spark json_schema call reads each caption beside the quotes it cites and the whole
 * transcript, and rewrites anything nobody said. The verdict is stored on the scene as
 * `checked`, the same field the web fact-check uses. Its `sources` stay empty: the scene's own
 * sources are already the recording moments, and the notes would print their host ("localhost").
 */
import type { Scene, Story } from "../../lib/schema";
import { MODELS, sparkJson } from "../meta";
import { fitCaption } from "../stages";
import { turnLine } from "./facts";
import type { FamilyFact, FamilyTurn } from "./types";

export const CHECK_SYSTEM = `You check the captions of a short family biography against the recording it was made from.
For each scene you get its caption and the quotes from the recording it cites; the whole transcript follows.
- If everything the caption says is supported by the transcript, verdict "ok" and return the caption unchanged.
- If it adds anything nobody said (feelings, memories, sights, objects, places, promises, numbers), verdict "corrected": rewrite it to say only what the transcript supports, in the same plain voice, one or two sentences, at most 30 words, keeping the year.
- note: one short line on what you removed or why it is fine.
Speech recognition may have stuttered ("married married"); ignore that.`;

export const checkSchema = {
  type: "object",
  additionalProperties: false,
  required: ["scenes"],
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "verdict", "caption", "note"],
        properties: { id: { type: "string" }, verdict: { type: "string", enum: ["ok", "corrected"] }, caption: { type: "string" }, note: { type: "string" } },
      },
    },
  },
};

interface Checked {
  scenes: { id: string; verdict: "ok" | "corrected"; caption: string; note: string }[];
}

/** The facts a scene cites, found by its source URLs. */
const citedBy = (scene: Scene, facts: FamilyFact[]) => facts.filter((f) => scene.sources.some((s) => s.url === f.source.url));

export const checkPrompt = (story: Story, facts: FamilyFact[], turns: FamilyTurn[]) =>
  `${story.scenes
    .map((s) => `Scene ${s.id} (${s.year}) caption: "${s.caption}"\nCites: ${citedBy(s, facts).map((f) => `[turn ${f.turn}] “${f.quote}”`).join("; ") || "(none)"}`)
    .join("\n\n")}\n\nTranscript:\n${turns.map(turnLine).join("\n")}`;

/** Apply the verdicts to a story (mutates it); returns how many captions were rewritten. */
export function applyChecks(story: Story, checked: Checked, at = new Date().toISOString()): number {
  let corrected = 0;
  for (const scene of story.scenes) {
    const c = checked.scenes.find((x) => x.id === scene.id);
    if (!c) continue;
    const caption = fitCaption(c.caption || scene.caption);
    const changed = c.verdict === "corrected" && caption && caption !== scene.caption;
    if (changed) {
      scene.caption = caption;
      corrected++;
    }
    scene.checked = { model: MODELS.spark, verdict: changed ? "corrected" : "ok", at, note: `Checked against the recording: ${c.note}`.slice(0, 400), sources: [] };
  }
  return corrected;
}

export async function checkCaptions(story: Story, facts: FamilyFact[], turns: FamilyTurn[]) {
  return sparkJson<Checked>(CHECK_SYSTEM, checkPrompt(story, facts, turns), "family_caption_check", checkSchema);
}
