/**
 * A /create job as the page sees it (job.json on disk, SSE snapshots on the wire); the parts
 * every job shares are in pipeline/jobs/types.ts. Type-only: safe to import from client components.
 */
import type { BaseJob, Rails } from "../jobs/types";

export type StepId = "screen" | "research" | "storyboard" | "plates" | "cutouts" | "frontispiece" | "films" | "direct";
export const STEP_ORDER: StepId[] = ["screen", "research", "storyboard", "plates", "cutouts", "frontispiece", "films", "direct"];
/** Scenes Muse Wonder directs at once, and the revisions it may ask for per scene on /create. */
export const DIRECT_PARALLEL = 2;
export const DIRECT_ROUNDS = 1;

export interface JobFact {
  n: number;
  year: string;
  text: string;
  sources: { label: string; url: string }[];
}

export interface Job extends BaseJob<StepId> {
  /** The reader supplied a photo for the frontispiece. */
  photo: boolean;
  /** The subject screen's answer; `message` is shown when the life was declined. */
  screen?: {
    category: string;
    known_for: string;
    ok: boolean;
    message?: string;
    /** Why it was declined: blocked, unverifiable, fictional, private, minor, ambiguous, not_singaporean, category. */
    refused?: string;
    /** What the web-search check found: the reason in one sentence and every source it cited. */
    check?: { status: string; singapore: boolean; minor: boolean; reason: string; sources: { label: string; url: string }[]; independent: number };
  };
  /** Made as a draft: off the shelf until `pnpm approve <slug>`. */
  draft?: boolean;
  facts: JobFact[];
  died?: string | null;
}

export interface CreateInfo extends Rails {
  /** Typical wall time of a run, seconds, by step. */
  estimate: Record<StepId, number>;
  job: Job | null;
  /** Added by the page and GET /api/create (components/create/shelf.ts): the books on the shelf, a sample life and the last real run. */
  shelf?: ShelfBook[];
  sample?: { slug: string; name: string; plates: { year: string; title: string; src: string }[] };
  last?: { slug: string; name: string; seconds: number; usd: number };
  /** The typical cost of one life, all steps, from lib/cost.ts (the figure quoted everywhere). */
  typical?: { usd: number; label: string; basis: string; wonderPerScene: number; direct: number };
}

/** A life on the shelf, as its cover is drawn. */
export interface ShelfBook {
  slug: string;
  name: string;
  lifespan: string;
  cloth: string;
}
