/**
 * What every job shares, /create's and /family's alike: steps, scenes, spend and the log, as
 * job.json holds them and the SSE stream sends them. Type-only: safe to import from client components.
 */
import type { Entry } from "../budget";

export type StepStatus = "waiting" | "running" | "done" | "skipped" | "failed" | "declined";
/** declined: /create's subject screen turned the name away before any research. */
export type JobStatus = "running" | "done" | "failed" | "interrupted" | "declined";

/** Spend by ledger kind (Meta model family), in USD. */
export type Spend = Partial<Record<Entry["kind"], number>>;

export interface StepState {
  status: StepStatus;
  startedAt?: string;
  endedAt?: string;
  usd: number;
  note?: string;
}

export interface JobCut {
  concept: string;
  src: string;
  x: number;
  y: number;
  w: number;
}

/** What Muse Wonder made of one scene: its plan's rationale and its own critique of the film. */
export interface JobWonder {
  status: "directing" | "directed" | "kept-fixed-move" | "failed";
  score?: number;
  /** Reached the critic's pass mark. */
  passed?: boolean;
  rationale?: string;
  verdict?: string;
  rounds?: number;
  usd?: number;
  note?: string;
}

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
  /** Muse Wonder's direction of this scene's film (/create's "Direct" step). */
  wonder?: JobWonder;
}

export interface JobLog<S extends string = string> {
  at: string;
  step: S;
  scene?: string;
  kind: "info" | "warn" | "error" | "asset" | "retry" | "refused";
  message: string;
  model?: string;
  url?: string;
}

export interface Frontispiece {
  kind: "photo" | "emblem";
  image?: string;
  lines?: string;
  strokes?: number;
  note?: string;
  /** Whose photo it is, when it isn't the reader's (a rehearsal shows the replayed life's credited portrait). */
  credit?: string;
}

/** A job with steps `S`: what the runner (pipeline/jobs/runner.ts) reads and writes. */
export interface BaseJob<S extends string> {
  slug: string;
  name: string;
  hint: string;
  /** A free replay of a finished book: no Meta calls, nothing written. */
  mock?: boolean;
  /** Where "Read the book" goes. */
  bookSlug: string;
  status: JobStatus;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  error?: string;
  steps: Record<S, StepState>;
  tagline?: string;
  born?: string;
  scenes: JobScene[];
  frontispiece?: Frontispiece;
  /** USD this book has cost so far, and the most it may cost. */
  usd: number;
  ceiling: number;
  spend: Spend;
  models: Record<string, string>;
  log: JobLog<S>[];
}

export interface Budget {
  /** Ledger total, the stop line, and what is left before it. */
  spent: number;
  stop: number;
  left: number;
  /** Spent on new books today, and the daily cap. */
  today: number;
  dailyCap: number;
}

/** The switches and money a workbench shows before a run (pipeline/jobs/guard.ts `rails`). */
export interface Rails {
  enabled: boolean;
  reason?: string;
  needsToken: boolean;
  mockAllowed: boolean;
  budget: Budget;
  /** Worst case one book may cost; also the per-book ceiling. */
  ceiling: number;
}
