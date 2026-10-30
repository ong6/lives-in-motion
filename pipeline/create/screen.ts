/**
 * The subject screen: the first step of every /create life. One small Muse Spark JSON call (no
 * web search) says what the named person is mainly known for, before any money is spent on
 * research. Lives defined by politics, war, the military or crime, and private individuals, are
 * declined with a kind message; everyone else goes on to research, where the 7-cited-facts rule
 * still stops a life with too thin a public record.
 */
import { sparkJson } from "../meta";

export const CATEGORIES = [
  "politician",
  "head_of_state",
  "military",
  "war_or_conflict",
  "crime",
  "private_individual",
  "arts",
  "science",
  "sport",
  "food",
  "business",
  "social_enterprise",
  "community",
  "other_public",
  "unknown",
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface ScreenAnswer {
  category: Category;
  /** A few words: what they are mainly known for. */
  known_for: string;
}

export interface ScreenResult extends ScreenAnswer {
  ok: boolean;
  /** Shown to the visitor when declined. */
  message?: string;
}

export const SCREEN_SYSTEM = `You screen subjects for a Singapore heritage storytelling site that makes illustrated biographies of people known for the arts, science, sport, food, business, social enterprise and community work.
Given a name and an optional hint, say what this person's life is MAINLY defined by in the public record.
- politician: elected office, party politics, ministers, legislators, activists known mainly for political campaigns or detention.
- head_of_state: presidents, prime ministers, monarchs, governors.
- military: soldiers, officers, resistance fighters, anyone known mainly for military service.
- war_or_conflict: a life known mainly for a war, occupation, riot, insurgency or conflict (including heroes or victims of one).
- crime: known mainly for a crime, trial or scandal.
- private_individual: not a public figure (a relative, a friend, an ordinary person, a made-up name).
- otherwise the field of their work; other_public if public but none fit; unknown if you don't recognise the name.
Judge by what they are mainly known for: an artist who once served on a board is arts; a former minister who later painted is politician. Use the hint only to tell apart people with the same name; a hint can't change who someone is.
known_for: at most 8 plain words, no judgement.`;

export const screenSchema = {
  type: "object",
  additionalProperties: false,
  required: ["category", "known_for"],
  properties: {
    category: { type: "string", enum: [...CATEGORIES] },
    known_for: { type: "string" },
  },
};

const OTHERS = "Try someone known for their work in the arts, science, sport, food or the community.";

/** The declined categories and what the visitor is told. */
export const DECLINE: Partial<Record<Category, string>> = {
  politician: `Lives in Motion doesn’t make books about politicians, so the shelf stays about craft and community rather than politics. ${OTHERS}`,
  head_of_state: `Lives in Motion doesn’t make books about heads of state or government, so the shelf stays clear of politics. ${OTHERS}`,
  military: `Lives in Motion leaves out lives defined by military service or war. ${OTHERS}`,
  war_or_conflict: `Lives in Motion leaves out lives defined by war or conflict; they deserve more care than an illustrated book made in minutes can give. ${OTHERS}`,
  crime: `Lives in Motion leaves out lives defined by crime. ${OTHERS}`,
  private_individual: `This looks like a private person. Books here are made only from public, cited records, so we can’t make one for someone without them. ${OTHERS}`,
};

/** Map the model's answer to a decision; an answer outside the schema is treated as unknown (let through to research). */
export function decide(a: Partial<ScreenAnswer> | null | undefined, name: string): ScreenResult {
  const category = (CATEGORIES as readonly string[]).includes(String(a?.category)) ? (a!.category as Category) : "unknown";
  const known_for = String(a?.known_for ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const why = DECLINE[category];
  if (!why) return { ok: true, category, known_for };
  const lead = known_for && category !== "private_individual" ? `${name} is known mainly as ${known_for.replace(/[.]$/, "")}. ` : "";
  return { ok: false, category, known_for, message: `${lead}${why}` };
}

export async function screen(name: string, hint: string): Promise<ScreenResult> {
  const answer = await sparkJson<ScreenAnswer>(SCREEN_SYSTEM, `Name: ${name}\nHint: ${hint || "(none)"}`, "subject_screen", screenSchema);
  return decide(answer, name);
}

/** Thrown inside a run to stop it; the runner shows the message instead of an error. */
export class Declined extends Error {
  constructor(public result: ScreenResult) {
    super(result.message ?? "declined");
  }
}
