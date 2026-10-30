/**
 * The shape of a /create job as the page sees it (job.json on disk, SSE snapshots on the wire).
 * Type-only: safe to import from client components.
 */
export type StepId = "screen" | "research" | "storyboard" | "plates" | "cutouts" | "frontispiece" | "films" | "direct";
export type StepStatus = "waiting" | "running" | "done" | "skipped" | "failed" | "declined";
/** declined: the subject screen turned the name away before any research. */
export type JobStatus = "running" | "done" | "failed" | "interrupted" | "declined";

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
export type Spend = Partial<Record<"spark" | "search" | "image" | "sam" | "wonder" | "manual", number>>;

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
  /** Muse Wonder's direction of this scene's film (the "Direct" step). */
  wonder?: JobWonder;
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
  steps: Record<StepId, { status: StepStatus; startedAt?: string; endedAt?: string; usd: number; note?: string }>;
  facts: JobFact[];
  tagline?: string;
  born?: string;
  died?: string | null;
  scenes: JobScene[];
  frontispiece?: {
    kind: "photo" | "emblem";
    image?: string;
    lines?: string;
    strokes?: number;
    note?: string;
    /** Whose photo it is, when it isn't the reader's (a rehearsal shows the replayed life's credited portrait). */
    credit?: string;
  };
  /** USD this life has cost so far, and the most it may cost. */
  usd: number;
  ceiling: number;
  spend: Spend;
  models: { spark: string; image: string; sam: string; wonder?: string };
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
  /** No longer shown: each life is its own book. */
  part?: string;
  cloth: string;
}

export const STEP_ORDER: StepId[] = ["screen", "research", "storyboard", "plates", "cutouts", "frontispiece", "films", "direct"];
