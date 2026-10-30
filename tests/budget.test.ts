import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BudgetError, PRICES, STOP, guard, record, sparkCost, spent } from "../pipeline/budget";

const ledger = () => join(mkdtempSync(join(tmpdir(), "lim-")), "spend.jsonl");

describe("budget guard", () => {
  it("records the priced cost of a call", async () => {
    const f = ledger();
    await guard("sam", 1, async () => "ok", () => PRICES.samImage, "person", f);
    expect(spent(f)).toBeCloseTo(0.0025);
  });

  it("refuses a call that could pass the stop line, without sending it", async () => {
    const f = ledger();
    record({ kind: "manual", usd: STOP - 0.005 }, f);
    let sent = false;
    await expect(guard("image", PRICES.image, async () => (sent = true), () => PRICES.image, undefined, f)).rejects.toBeInstanceOf(BudgetError);
    expect(sent).toBe(false);
  });

  it("counts calls still in flight", async () => {
    const f = ledger();
    record({ kind: "manual", usd: STOP - 1.5 }, f);
    let release!: () => void;
    const slow = guard("spark", 1, () => new Promise<void>((r) => (release = r)), () => 1, undefined, f);
    await expect(guard("spark", 1, async () => {}, () => 1, undefined, f)).rejects.toBeInstanceOf(BudgetError);
    release();
    await slow;
  });

  it("falls back to the worst case when the response can't be priced", async () => {
    const f = ledger();
    await guard("spark", 0.07, async () => ({}), (r: any) => sparkCost(r.usage), undefined, f);
    expect(spent(f)).toBeCloseTo(0.07);
  });

  it("prices Spark usage with cached input and searches", () => {
    const usd = sparkCost({ prompt_tokens: 1_000_000, completion_tokens: 1_000_000, prompt_tokens_details: { cached_tokens: 0 } }, 4);
    expect(usd).toBeCloseTo(1.25 + 4.25 + 0.01);
  });
});
