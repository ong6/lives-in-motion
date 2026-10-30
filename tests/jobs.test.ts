import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BudgetError, guard, withScope } from "../pipeline/budget";
import { createRunner, friendly } from "../pipeline/jobs/runner";
import { jobScenes, limiter } from "../pipeline/jobs/steps";
import { jobStream } from "../pipeline/jobs/stream";
import type { BaseJob } from "../pipeline/jobs/types";
import { Story } from "../lib/schema";

type S = "one" | "two";
type J = BaseJob<S> & { extra?: string };

const dir = mkdtempSync(join(tmpdir(), "lim-jobs-"));
let n = 0;
/** A runner of its own (its own globalThis key and folder), so tests don't share a live job. */
function make(o: Partial<Parameters<typeof createRunner<S, J>>[0]> = {}) {
  const key = `__limTest${++n}`;
  const file = (slug: string) => join(dir, key, slug, "job.json");
  return Object.assign(createRunner<S, J>({ key, file, label: "a test", failedAt: () => "one", ...o }), { file });
}
const job = (slug: string, o: Partial<J> = {}): J => ({
  slug,
  name: "N",
  hint: "",
  bookSlug: slug,
  status: "running",
  startedAt: new Date().toISOString(),
  updatedAt: "",
  steps: { one: { status: "waiting", usd: 0 }, two: { status: "waiting", usd: 0 } },
  scenes: [{ id: "s1", year: "1990", title: "T", caption: "C", treatment: "theatre", status: "waiting", cuts: [], spend: {} }],
  usd: 0,
  ceiling: 2,
  spend: {},
  models: {},
  log: [],
  ...o,
});

describe("the job runner", () => {
  it("runs a job to done: steps keep their clocks, the log fills, the file and every listener get the final state", async () => {
    const r = make();
    const seen: string[] = [];
    r.subscribe((j) => seen.push(j.status));
    await r.launch(job("a"), async () => {
      expect(r.busy()).toBe("a");
      r.step("one", "running");
      r.log({ step: "one", kind: "info", message: "hello" });
      r.step("one", "done");
      // A finished step is passed through, not restarted.
      r.step("one", "running");
    });
    const j = r.getJob("a")!;
    expect(j.status).toBe("done");
    expect(j.steps.one.status).toBe("done");
    expect(j.steps.one.startedAt && j.steps.one.endedAt).toBeTruthy();
    expect(j.log.map((l) => l.message)).toEqual(["hello"]);
    expect(seen.at(-1)).toBe("done");
    expect(r.busy()).toBeNull();
    await new Promise((res) => setTimeout(res, 20));
    expect(r.readJob("a")?.status).toBe("done");
  });

  it("fails a job with a readable error, marks running steps failed and logs under the failing step", async () => {
    const r = make({ failedAt: (j) => (j.steps.two.status === "running" ? "two" : "one") });
    await r.launch(job("b"), async () => {
      r.step("two", "running");
      throw new Error('/responses 400: {"error":{"message":"bad \\"size\\""}}');
    });
    const j = r.getJob("b")!;
    expect(j).toMatchObject({ status: "failed", error: 'HTTP 400: bad "size"' });
    expect(j.steps.two.status).toBe("failed");
    expect(j.log.at(-1)).toMatchObject({ step: "two", kind: "error" });
  });

  it("names the budget guard when it stopped the run", async () => {
    const r = make();
    await r.launch(job("c"), async () => {
      throw new BudgetError("budget: over the line");
    });
    expect(r.getJob("c")!.error).toBe("Budget guard: over the line");
  });

  it("lets a runner end a job its own way (the subject screen's decline)", async () => {
    class Stop extends Error {}
    const r = make({ stopped: (e) => (e instanceof Stop ? (j) => void ((j.status = "declined"), (j.extra = "why")) : undefined) });
    await r.launch(job("d"), async () => {
      throw new Stop();
    });
    expect(r.getJob("d")).toMatchObject({ status: "declined", extra: "why" });
  });

  it("never writes a replay, and reads an interrupted file back as interrupted, upgraded", async () => {
    const r = make({ upgrade: (j) => ({ ...j, extra: "upgraded" }) });
    await r.launch(job("e", { mock: true }), async () => {});
    await new Promise((res) => setTimeout(res, 20));
    expect(r.readJob("e")).toBeNull();
    mkdirSync(join(r.file("f"), ".."), { recursive: true });
    writeFileSync(r.file("f"), JSON.stringify(job("f")));
    expect(r.getJob("f")).toMatchObject({ status: "interrupted", extra: "upgraded" });
    expect(r.getJob("../f")).toBeNull();
  });

  it("puts ledger spend on the job, its step and its scene, tagged to the book", async () => {
    const r = make();
    const ledger = join(dir, "spend.jsonl");
    writeFileSync(ledger, "");
    await r.launch(job("g"), () =>
      withScope(r.spendScope("g"), async () => void (await r.scoped("two", "s1", () => guard("image", 0.01, async () => "ok", () => 0.01, "plate", ledger)))),
    );
    const j = r.getJob("g")!;
    expect(j.usd).toBe(0.01);
    expect(j.spend).toEqual({ image: 0.01 });
    expect(j.steps.two.usd).toBe(0.01);
    expect(j.scenes[0].spend).toEqual({ image: 0.01 });
    expect(JSON.parse(readFileSync(ledger, "utf8")).job).toBe("create:g");
  });

  it("turns stage events into scene state and log lines", async () => {
    const r = make();
    await r.launch(job("h"), async () => {
      const on = r.onStage("one");
      on({ stage: "illustrate", scene: "s1", kind: "plate", message: "plate", url: "/p.webp" });
      on({ stage: "segment", scene: "s1", kind: "cut", message: "cut", url: "/c.webp", data: { concept: "toilet", src: "/c.webp", x: 50, y: 90, w: 30, depth: 0.6 } });
      on({ stage: "segment", scene: "s1", kind: "warn", message: "no background" });
    });
    const j = r.getJob("h")!;
    expect(j.scenes[0]).toMatchObject({ plate: "/p.webp", status: "painted", cuts: [{ concept: "toilet", src: "/c.webp", x: 50, y: 90, w: 30 }] });
    expect(j.log.map((l) => l.kind)).toEqual(["asset", "asset", "warn"]);
  });

  it("gives the plain error line of an API failure", () => {
    expect(friendly(new Error("plain words"))).toBe("plain words");
    expect(friendly('/x 429: {"message":"slow `down`"}')).toBe("HTTP 429: slow down");
  });
});

describe("shared steps", () => {
  it("runs at most n tasks at once", async () => {
    const lane = limiter(2);
    let live = 0, most = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        lane(async () => {
          most = Math.max(most, ++live);
          await new Promise((res) => setTimeout(res, 2));
          live--;
        }),
      ),
    );
    expect(most).toBe(2);
  });

  it("maps a story's scenes to job scenes, keeping notes and spend", () => {
    const story = Story.parse({
      slug: "x",
      name: "X",
      born: "1950",
      died: null,
      tagline: "t",
      scenes: ["s1", "s2", "s3"].map((id, i) => ({ id, year: String(1960 + i), title: id, caption: "c", visual: "v", sources: [{ label: "l", url: "https://e.org" }], ...(i === 0 ? { plate: "/p.webp", background: "/b.webp", layers: [{ id: "cut-1", concept: "boy", depth: 0.6, x: 50, y: 90, w: 20, src: "/c.webp" }] } : i === 1 ? { plate: "/p2.webp" } : {}) })),
    });
    const rows = jobScenes(story, [{ id: "s2", note: "kept", spend: { image: 0.01 } } as never]);
    expect(rows.map((s) => s.status)).toEqual(["done", "painted", "waiting"]);
    expect(rows[1]).toMatchObject({ note: "kept", spend: { image: 0.01 } });
    expect(rows[0].cuts).toEqual([{ concept: "boy", src: "/c.webp", x: 50, y: 90, w: 20 }]);
  });
});

describe("the job stream", () => {
  it("sends the current state at once and closes when the job is over", async () => {
    const done = job("s", { status: "done" });
    const res = jobStream(new Request("http://x/"), "s", { getJob: () => done, subscribe: () => () => {} }, () => ({ spent: 1, stop: 135, left: 134, today: 0, dailyCap: 10 }));
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const text = await res.text();
    expect(text.startsWith("data: ")).toBe(true);
    expect(JSON.parse(text.slice(6))).toMatchObject({ job: { slug: "s", status: "done" }, budget: { left: 134 } });
  });

  it("forwards changes to this job only, until it finishes", async () => {
    const listeners = new Set<(j: J) => void>();
    const live = job("t");
    const res = jobStream(new Request("http://x/"), "t", { getJob: () => live, subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)) }, () => ({ spent: 0, stop: 135, left: 135, today: 0, dailyCap: 10 }));
    const body = res.text();
    for (const l of listeners) l(job("other", { status: "done" }));
    for (const l of [...listeners]) l({ ...live, status: "done" });
    const events = (await body).split("\n\n").filter(Boolean).map((e) => JSON.parse(e.slice(6)).job);
    expect(events.map((e: J) => `${e.slug}:${e.status}`)).toEqual(["t:running", "t:done"]);
    expect(listeners.size).toBe(0);
  });
});
