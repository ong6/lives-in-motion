/**
 * Spend guard for the Meta Model API. The event gives one $150 allowance, so every paid call
 * goes through `guard`: it refuses a call whose worst-case cost would take the ledger past the
 * stop line, then records what the call actually cost from the response's usage.
 *
 * The ledger is spend.jsonl at the repo root, append-only and committed, so every machine sees
 * the same total. Spend made outside this pipeline (console playground, curl tests) is added
 * with `pnpm spend --add <usd> "<note>"`.
 *
 * Prices: https://dev.meta.ai/docs/pricing-rate-limits (Standard mode, checked 2026-10-30).
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const PRICES = {
  sparkInput: 1.25 / 1e6,
  sparkCachedInput: 0.15 / 1e6,
  sparkOutput: 4.25 / 1e6,
  webSearch: 2.5 / 1000,
  image: 0.01,
  samImage: 2.5 / 1000,
};

/** The event allowance, and the reserve kept back for estimate error and spend we can't see. */
export const CAP = Number(process.env.BUDGET_CAP_USD ?? 150);
export const RESERVE = Number(process.env.BUDGET_RESERVE_USD ?? 15);
export const STOP = CAP - RESERVE;

const LEDGER = join(new URL("..", import.meta.url).pathname, "spend.jsonl");

export interface Entry {
  at: string;
  kind: "spark" | "search" | "image" | "sam" | "manual";
  usd: number;
  note?: string;
}

export class BudgetError extends Error {}

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

export function record(e: Omit<Entry, "at">, file = LEDGER) {
  appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...e, usd: +e.usd.toFixed(6) }) + "\n");
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
  pending += worst;
  try {
    const r = await call();
    let usd = worst;
    try {
      usd = actual(r);
    } catch {
      /* unpriceable response: keep the worst case */
    }
    record({ kind, usd, note }, file);
    return r;
  } catch (e) {
    // A response lost mid-download may still have been billed: count the worst case so the ledger never undercounts.
    if ((e as { maybeBilled?: boolean })?.maybeBilled) record({ kind, usd: worst, note: `unconfirmed: ${note ?? ""}` }, file);
    throw e;
  } finally {
    pending -= worst;
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const [flag, usd, ...note] = process.argv.slice(2);
  if (flag === "--add") {
    if (!(Number(usd) > 0)) throw new Error('usage: pnpm spend --add <usd> "<note>"');
    record({ kind: "manual", usd: Number(usd), note: note.join(" ") || undefined });
  }
  const s = summary();
  for (const [k, v] of Object.entries(s.by)) console.log(`${k.padEnd(7)} ${String(v.n).padStart(5)} calls  $${v.usd.toFixed(4)}`);
  console.log(`spent $${s.total.toFixed(2)} of $${s.cap} · calls stop at $${s.stop} · $${s.left.toFixed(2)} left before the stop`);
}
