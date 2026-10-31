import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DeepChapter } from "./lines";

/**
 * The research agent's notes beside a life (stories/<slug>/deep/), read only: its storyboard's
 * chapters (for sourced quotations and human details) and its research facts (for dated days).
 * A life without them simply has none; a malformed file is skipped, never fatal to the home page.
 */
function readJson<T>(slug: string, file: string): T | undefined {
  const f = join(process.cwd(), "stories", slug, "deep", file);
  if (!/^[a-z0-9-]+$/.test(slug) || !existsSync(f)) return undefined;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export function deepChapters(slug: string): DeepChapter[] | undefined {
  const sb = readJson<{ chapters?: DeepChapter[] }>(slug, "storyboard.json");
  return Array.isArray(sb?.chapters) ? sb.chapters.filter((c) => typeof c?.title === "string" && typeof c?.year === "string") : undefined;
}

export function deepFacts(slug: string): string[] {
  const r = readJson<{ facts?: { text?: unknown }[] }>(slug, "research.json");
  return Array.isArray(r?.facts) ? r.facts.map((f) => f?.text).filter((t): t is string => typeof t === "string") : [];
}

/**
 * The family section's sample: a line Ah Ma says in the sample recording (a fictional voice,
 * labelled as such), and when she says it. Undefined if the sample isn't there.
 */
export function familySample(): { slug: string; label: string; line: string; at: number } | undefined {
  const f = join(process.cwd(), "stories", "ah-ma-sample", "family.json");
  if (!existsSync(f)) return undefined;
  try {
    const fam = JSON.parse(readFileSync(f, "utf8")) as { slug: string; label?: string; transcript?: { turns?: { startMs: number; text: string; speaker: string }[] } };
    const turns = fam.transcript?.turns ?? [];
    // The grandmother is the second voice in the recording; take her line about the sewing machine, else her first.
    const hers = turns.filter((t) => t.speaker === turns[1]?.speaker);
    const turn = hers.find((t) => /sewing machine/i.test(t.text)) ?? hers[0];
    if (!turn) return undefined;
    const sentences = turn.text.match(/[^.!?]+[.!?]/g) ?? [turn.text];
    const k = Math.max(0, sentences.findIndex((x) => /sewing machine/i.test(x)));
    const line = sentences.slice(k, k + 2).join("").trim();
    return { slug: fam.slug, label: fam.label ?? "A sample recording", line, at: Math.round(turn.startMs / 1000) };
  } catch {
    return undefined;
  }
}
