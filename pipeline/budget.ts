/**
 * Spend guard for the Meta Model API. The event gives one $150 allowance, so every paid call
 * goes through `guard`: it refuses a call whose worst-case cost would take the ledger past the
 * stop line, then records what the call actually cost from the response's usage.
 *
 * The ledger is spend.jsonl at the repo root, append-only and committed, so every machine sees
 * the same total. Spend made outside this pipeline (console playground, curl tests) is added
 * with `pnpm spend --add <usd> "<note>"`.
 *
 * Prices: https://dev.meta.ai/docs/pricing-rate-limits (Standard mode, checked 2026-10-30). This is
 * the one price table; pipeline/meta.ts prices every call from it.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./root";

export const PRICES = {
  sparkInput: 1.25 / 1e6,
  sparkCachedInput: 0.15 / 1e6,
  sparkOutput: 4.25 / 1e6,
  webSearch: 2.5 / 1000,
  image: 0.01,
  samImage: 2.5 / 1000,
  /** Muse Wonder (muse-wonder-1.0, Standard mode only). */
  wonderInput: 4 / 1e6,
  wonderCachedInput: 0.2 / 1e6,
  wonderOutput: 20 / 1e6,
  /** Muse Voice Transcribe: $0.18 an hour of audio, billed per whole second; failed and 429 requests are free. */
  transcribe: 0.18 / 3600,
};

/** The event allowance, and the reserve kept back for estimate error and spend we can't see. */
export const CAP = Number(process.env.BUDGET_CAP_USD ?? 150);
export const RESERVE = Number(process.env.BUDGET_RESERVE_USD ?? 15);
export const STOP = CAP - RESERVE;

const LEDGER = join(ROOT, "spend.jsonl");

export interface Entry {
  at: string;
  kind: "spark" | "search" | "image" | "sam" | "wonder" | "transcribe" | "manual";
  usd: number;
  note?: string;
  /** The job a call was made for ("create:<slug>" for lives made on /create). */
  job?: string;
}

export class BudgetError extends Error {}

/**
 * Who is spending, carried through async calls: the job tag written to the ledger, an optional
 * per-job ceiling (refused like the stop line), and hooks for the live progress feed.
 */
export interface SpendScope {
  job?: string;
  /** Most this job may spend in total; a call that could pass it is refused. */
  limit?: number;
  onSpend?: (e: Entry) => void;
  /** A transient failure being retried ("429, retrying in 6 s"). */
  onRetry?: (message: string) => void;
}
const scopes = new AsyncLocalStorage<SpendScope>();

/** Run `fn` with extra scope; inner hooks run as well as outer ones. */
export function withScope<T>(scope: SpendScope, fn: () => Promise<T>): Promise<T> {
  const outer = scopes.getStore() ?? {};
  const both = <A extends unknown[]>(a?: (...x: A) => void, b?: (...x: A) => void) => (a && b ? (...x: A) => (a(...x), b(...x)) : (a ?? b));
  return scopes.run({ job: scope.job ?? outer.job, limit: scope.limit ?? outer.limit, onSpend: both(outer.onSpend, scope.onSpend), onRetry: both(outer.onRetry, scope.onRetry) }, fn);
}
export const currentScope = () => scopes.getStore();

/** What one job has spent so far, from the ledger. */
export const spentBy = (job: string, file = LEDGER) => entries(file).filter((e) => e.job === job).reduce((a, e) => a + e.usd, 0);

export function entries(file = LEDGER): Entry[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Entry);
}

export const spent = (file = LEDGER) => entries(file).reduce((a, e) => a + e.usd, 0);

/** Worst case still in flight in this process, so parallel calls can't overshoot together. */
let pending = 0;
const pendingBy = new Map<string, number>();

export function record(e: Omit<Entry, "at">, file = LEDGER): Entry {
  const job = e.job ?? scopes.getStore()?.job;
  const entry: Entry = { at: new Date().toISOString(), ...e, usd: +e.usd.toFixed(6), ...(job ? { job } : {}) };
  appendFileSync(file, JSON.stringify(entry) + "\n");
  return entry;
}

/**
 * Run a paid call. `worst` is the most it can cost; `actual` prices the response. If the
 * response can't be priced, the worst case is recorded instead.
 */
export async function guard<T>(kind: Entry["kind"], worst: number, call: () => Promise<T>, actual: (r: T) => number, note?: string, file = LEDGER): Promise<T> {
  const total = spent(file);
  if (total + pending + worst > STOP)
    throw new BudgetError(
      `budget: $${total.toFixed(2)} spent + $${(pending + worst).toFixed(2)} for this call would pass the $${STOP} stop line ($${CAP} cap, $${RESERVE} reserve). Nothing was sent.`,
    );
  const scope = scopes.getStore();
  const job = scope?.job;
  if (job && scope?.limit != null) {
    const mine = spentBy(job, file) + (pendingBy.get(job) ?? 0);
    if (mine + worst > scope.limit)
      throw new BudgetError(`budget: this life has spent $${mine.toFixed(2)}; another $${worst.toFixed(2)} could pass its $${scope.limit.toFixed(2)} ceiling. Nothing was sent.`);
  }
  pending += worst;
  if (job) pendingBy.set(job, (pendingBy.get(job) ?? 0) + worst);
  try {
    const r = await call();
    let usd = worst;
    try {
      usd = actual(r);
    } catch {
      /* unpriceable response: keep the worst case */
    }
    // Record first, then tell the scope: an optional call would skip evaluating its argument.
    const entry = record({ kind, usd, note }, file);
    scope?.onSpend?.(entry);
    return r;
  } catch (e) {
    // A response lost mid-download may still have been billed: count the worst case so the ledger never undercounts.
    if ((e as { maybeBilled?: boolean })?.maybeBilled) {
      const entry = record({ kind, usd: worst, note: `unconfirmed: ${note ?? ""}` }, file);
      scope?.onSpend?.(entry);
    }
    throw e;
  } finally {
    pending -= worst;
    if (job) pendingBy.set(job, (pendingBy.get(job) ?? 0) - worst);
  }
}

/** Cost of a Muse Spark response from its usage (Chat Completions or Responses shapes). */
export function sparkCost(usage: any, searches = 0): number {
  const input = usage?.prompt_tokens ?? usage?.input_tokens;
  const output = usage?.completion_tokens ?? usage?.output_tokens;
  if (input == null || output == null) throw new Error("no usage");
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? usage?.input_tokens_details?.cached_tokens ?? 0;
  return (input - cached) * PRICES.sparkInput + cached * PRICES.sparkCachedInput + output * PRICES.sparkOutput + searches * PRICES.webSearch;
}

/** Cost of a Muse Wonder response from its usage (Chat Completions or Responses shapes). */
export function wonderCost(usage: any): number {
  const input = usage?.prompt_tokens ?? usage?.input_tokens;
  const output = usage?.completion_tokens ?? usage?.output_tokens;
  if (input == null || output == null) throw new Error("no usage");
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? usage?.input_tokens_details?.cached_tokens ?? 0;
  return (input - cached) * PRICES.wonderInput + cached * PRICES.wonderCachedInput + output * PRICES.wonderOutput;
}

/** Cost of transcribing `durationMs` of audio: whole seconds, rounded down. */
export const transcribeCost = (durationMs: number) => Math.floor(durationMs / 1000) * PRICES.transcribe;

/**
 * Worst case for a Wonder call: the text (about 3 chars a token), each image at a generous
 * token count (the docs give no per-image figure), and the whole output cap (reasoning included).
 */
export const wonderWorst = (promptChars: number, images: number, maxOutput: number, tokensPerImage = 6000) =>
  (promptChars / 3 + images * tokensPerImage + 2000) * PRICES.wonderInput + maxOutput * PRICES.wonderOutput;

/** Worst case for a Spark call: the prompt (about 3 chars a token, plus images) and the output cap. */
export const sparkWorst = (promptChars: number, maxOutput: number, maxSearches = 0) =>
  (promptChars / 3 + 2000) * PRICES.sparkInput + maxOutput * PRICES.sparkOutput + maxSearches * PRICES.webSearch;

export function summary(file = LEDGER) {
  const by: Record<string, { n: number; usd: number }> = {};
  for (const e of entries(file)) {
    by[e.kind] ??= { n: 0, usd: 0 };
    by[e.kind].n++;
    by[e.kind].usd += e.usd;
  }
  const total = spent(file);
  return { by, total, cap: CAP, stop: STOP, left: STOP - total };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [flag, usd, ...note] = process.argv.slice(2);
  if (flag === "--add") {
    if (!(Number(usd) > 0)) throw new Error('usage: pnpm spend --add <usd> "<note>"');
    record({ kind: "manual", usd: Number(usd), note: note.join(" ") || undefined });
  }
  const s = summary();
  for (const [k, v] of Object.entries(s.by)) console.log(`${k.padEnd(7)} ${String(v.n).padStart(5)} calls  $${v.usd.toFixed(4)}`);
  console.log(`spent $${s.total.toFixed(2)} of $${s.cap} · calls stop at $${s.stop} · $${s.left.toFixed(2)} left before the stop`);
}
