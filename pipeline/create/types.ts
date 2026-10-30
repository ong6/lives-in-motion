/**
 * The shape of a /create job as the page sees it (job.json on disk, SSE snapshots on the wire).
 * Type-only: safe to import from client components.
 */
export type StepId = "research" | "storyboard" | "plates" | "cutouts" | "frontispiece" | "films";
export type StepStatus = "waiting" | "running" | "done" | "skipped" | "failed";
export type JobStatus = "running" | "done" | "failed" | "interrupted";

export interface JobFact {
  n: number;
  year: string;
  text: string;
  sources: { label: string; url: string }[];
}

export interface JobCut {
  concept: string;
  src: string;
  x: number;
  y: number;
  w: number;
}

/** Spend by Meta model family, in USD. */
export type Spend = Partial<Record<"spark" | "search" | "image" | "sam" | "manual", number>>;

export interface JobScene {
  id: string;
  year: string;
  title: string;
  caption: string;
  treatment: string;
  status: "waiting" | "painting" | "painted" | "cutting" | "done" | "refused" | "failed";
  plate?: string;
  cuts: JobCut[];
  background?: string;
  line?: string;
  poster?: string;
  video?: string;
  note?: string;
  spend: Spend;
}

export interface JobLog {
  at: string;
  step: StepId;
  scene?: string;
  kind: "info" | "warn" | "error" | "asset" | "retry" | "refused";
  message: string;
  model?: string;
  url?: string;
}

export interface Job {
  slug: string;
  name: string;
  hint: string;
  photo: boolean;
  /** A rehearsal: replays an existing life with no Meta calls and no spend. */
  mock?: boolean;
  /** Where "Read the book" goes. */
  bookSlug: string;
  status: JobStatus;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  error?: string;
  steps: Record<StepId, { status: StepStatus; startedAt?: string; endedAt?: string; usd: number; note?: string }>;
  facts: JobFact[];
  tagline?: string;
  born?: string;
  died?: string | null;
  scenes: JobScene[];
  frontispiece?: { kind: "photo" | "emblem"; image?: string; lines?: string; strokes?: number; note?: string };
  /** USD this life has cost so far, and the most it may cost. */
  usd: number;
  ceiling: number;
  spend: Spend;
  models: { spark: string; image: string; sam: string };
  log: JobLog[];
}

export interface Budget {
  /** Ledger total, the stop line, and what is left before it. */
  spent: number;
  stop: number;
  left: number;
  /** Spent on /create lives today, and the daily cap. */
  today: number;
  dailyCap: number;
}

export interface CreateInfo {
  enabled: boolean;
  reason?: string;
  needsToken: boolean;
  mockAllowed: boolean;
  budget: Budget;
  /** Worst case one life may cost; also the per-life ceiling. */
  ceiling: number;
  /** Typical wall time of a run, seconds, by step. */
  estimate: Record<StepId, number>;
  job: Job | null;
}

export const STEP_ORDER: StepId[] = ["research", "storyboard", "plates", "cutouts", "frontispiece", "films"];
