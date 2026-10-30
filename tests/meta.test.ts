import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A throwaway repo root, so the ledger these calls write is not the real spend.jsonl. No network:
// fetch is stubbed in every test.
const root = mkdtempSync(join(tmpdir(), "lim-meta-"));
process.env.LIM_ROOT = root;
process.env.MODEL_API_KEY = "test-key";
const { JSON_RETRY, MODELS, TRANSCRIBE_RETRY, museImage, museTranscribe, send, sparkJson } = await import("../pipeline/meta");
const { PRICES, withScope } = await import("../pipeline/budget");

const ledger = join(root, "spend.jsonl");
const rows = () => readFileSync(ledger, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const fetchMock = vi.fn<typeof fetch>();

/** Run a call to completion with the retry waits skipped. */
async function settle<T>(p: Promise<T>): Promise<T> {
  const out = p.then((v) => ({ v }), (e) => ({ e }));
  await vi.runAllTimersAsync();
  const r = (await out) as { v?: T; e?: unknown };
  if ("e" in r) throw r.e;
  return r.v as T;
}

beforeEach(() => {
  writeFileSync(ledger, "");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("send: one request, with retries", () => {
  it("retries a 429, honouring retry-after, and reports each retry to the scope", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "slow down" }, 429, { "retry-after": "3" })).mockResolvedValueOnce(json({ ok: 1 }));
    const retries: string[] = [];
    const r = await settle(withScope({ onRetry: (m) => retries.push(m) }, () => send("/x", () => ({ method: "POST" }))));
    expect(r).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(retries).toEqual(["rate limited; retrying in 3 s"]);
  });

  it("sends the key as a bearer token and never retries a 4xx", async () => {
    fetchMock.mockImplementation(async () => json({ error: { message: "bad param" } }, 400));
    await expect(settle(sparkJson("sys", "user", "t", {}))).rejects.toThrow(/^\/chat\/completions 400: /);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(rows()).toEqual([]);
  });

  it("retries a dropped connection, then gives up after its attempts", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(json({ ok: 2 }));
    expect(await settle(send("/x", () => ({})))).toEqual({ ok: 2 });
    fetchMock.mockReset().mockRejectedValue(new Error("ECONNRESET"));
    await expect(settle(send("/x", () => ({})))).rejects.toThrow("ECONNRESET");
    expect(fetchMock).toHaveBeenCalledTimes(JSON_RETRY.networkTries);
  });

  it("stops retrying a 5xx after six attempts on the JSON endpoints, and after one retry for transcription", async () => {
    fetchMock.mockImplementation(async () => json({}, 503));
    await expect(settle(send("/x", () => ({})))).rejects.toThrow("/x 503");
    expect(fetchMock).toHaveBeenCalledTimes(JSON_RETRY.tries);
    fetchMock.mockReset().mockImplementation(async () => json({}, 500));
    await expect(settle(send("/asr/transcribe", () => ({}), TRANSCRIBE_RETRY))).rejects.toThrow("500");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("builds the request afresh for each attempt", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 502)).mockResolvedValueOnce(json({ ok: 3 }));
    const init = vi.fn(() => ({ body: new FormData() }));
    await settle(send("/x", init));
    expect(init).toHaveBeenCalledTimes(2);
  });
});

describe("billing: every call through the guard, priced from PRICES", () => {
  it("records a Spark call at its usage, tagged with the scope's job", async () => {
    fetchMock.mockResolvedValue(json({ choices: [{ message: { content: '{"a":1}' } }], usage: { prompt_tokens: 1000, completion_tokens: 200 } }));
    const r = await settle(withScope({ job: "create:test" }, () => sparkJson<{ a: number }>("sys", "user", "storyboard", {})));
    expect(r).toEqual({ a: 1 });
    const [row] = rows();
    expect(row).toMatchObject({ kind: "spark", note: "storyboard", job: "create:test" });
    expect(row.usd).toBeCloseTo(1000 * PRICES.sparkInput + 200 * PRICES.sparkOutput, 6);
  });

  it("bills Muse Image per image returned", async () => {
    fetchMock.mockResolvedValue(json({ output: [{ type: "image_generation_call", result: Buffer.from("png").toString("base64") }] }));
    expect(String(await settle(museImage("a plate")))).toBe("png");
    expect(rows()[0]).toMatchObject({ kind: "image", usd: PRICES.image });
  });

  it("records the worst case when an answer is lost mid-read, and doesn't retry it", async () => {
    fetchMock.mockResolvedValue(new Response("{ not json", { status: 200 }));
    await expect(settle(museImage("a plate"))).rejects.toThrow(/response lost mid-read/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rows()[0]).toMatchObject({ kind: "image", usd: PRICES.image, note: "unconfirmed: a plate" });
  });

  it("bills transcription by the seconds processed, sends the model id, and retries a 429 for free", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 429)).mockResolvedValueOnce(json({ audioDurationMs: 61_900, turns: [] }));
    await settle(museTranscribe(Buffer.alloc(100), { mode: "DIARIZATION" }, 62, "family: x"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const form = fetchMock.mock.calls[1][1]!.body as FormData;
    expect(JSON.parse(await (form.get("request") as Blob).text())).toEqual({ model: MODELS.transcribe, mode: "DIARIZATION" });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ kind: "transcribe", note: "family: x" });
    expect(rows()[0].usd).toBeCloseTo(61 * PRICES.transcribe, 6);
  });
});
