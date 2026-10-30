/**
 * A family-book job as the /family page sees it (family-job.json on disk, SSE on the wire); the
 * parts every job shares are in pipeline/jobs/types.ts. Type-only: safe to import from client components.
 */
import type { BaseJob, Rails } from "../jobs/types";

export type FamilyStepId = "transcribe" | "facts" | "storyboard" | "plates" | "cutouts" | "frontispiece" | "films";
export const FAMILY_STEPS: FamilyStepId[] = ["transcribe", "facts", "storyboard", "plates", "cutouts", "frontispiece", "films"];

export interface FamilyTurn {
  n: number;
  /** Start and end in ms; -1 when the transcript came back without timestamps. */
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
}

/** One dated fact from the recording, with the words it rests on and where they were said. */
export interface FamilyFact {
  n: number;
  year: string;
  /** The year is the storyteller's estimate ("maybe 1938", "when I was fourteen"). */
  approx: boolean;
  text: string;
  /** Verbatim span of the transcript the fact rests on. */
  quote: string;
  turn: number;
  /** Seconds into the recording where that turn starts; -1 when untimed. */
  t: number;
  /** The citation as the book's notes show it. */
  source: { label: string; url: string };
}

export interface FamilyJob extends BaseJob<FamilyStepId> {
  /** Family photos supplied (with consent) for the frontispiece. */
  photos: number;
  /** The demo book made from the fictional sample recording. */
  sample?: boolean;
  /** Where the recording plays from (the book's audio route). */
  audio?: string;
  durationMs?: number;
  /** Turns revealed so far (all of them once transcription is done). */
  turns: FamilyTurn[];
  /** Speaker label of the person whose life it is, when the model could tell. */
  subject?: string;
  facts: FamilyFact[];
}

export interface FamilyInfo extends Rails {
  /** Seconds, by step, for a 3-minute recording. */
  estimate: Record<FamilyStepId, number>;
  limits: { seconds: number; uploadMb: number; photos: number; photoMb: number };
  /** The sample book, if it has been made. */
  sample?: { slug: string; name: string; label: string; audio: string; download: string; seconds: number; usd?: number; took?: number; plates: { year: string; title: string; src: string }[] };
  job: FamilyJob | null;
}
