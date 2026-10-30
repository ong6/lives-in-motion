import "server-only";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getStory } from "@/lib/stories";
import { audioUrl, readRecord } from "@/pipeline/family";
import type { RecordProps } from "@/components/family/RecordView";

/** What a family book's recording page shows, or null when there is no such family book. */
export function recordProps(slug: string): RecordProps | null {
  const r = readRecord(slug);
  if (!r?.transcript) return null;
  const story = getStory(slug);
  return {
    slug,
    name: r.name,
    tagline: story?.tagline,
    label: r.label,
    sample: Boolean(r.sample),
    audio: audioUrl(slug),
    seconds: Math.round((r.durationMs ?? r.transcript.durationMs) / 1000),
    turns: r.transcript.turns,
    facts: r.facts ?? [],
    subject: r.subject,
    hasBook: Boolean(story) && existsSync(join(process.cwd(), "stories", slug, "story.json")),
    untimed: Boolean(r.transcript.untimed),
    model: r.transcript.model,
  };
}
