import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BudgetError, guard, record, spent, withScope, type Entry } from "../pipeline/budget";
import { LIFE_CEILING, MIN_HEADROOM, createEnabled, dailyCap, preflight, slugify, sniffImage, spentToday, tokenOk, uniqueSlug, validateInput, validatePhoto } from "../pipeline/jobs/guard";
import { fitCaption, pool } from "../pipeline/stages";

const ledger = () => join(mkdtempSync(join(tmpdir(), "lim-create-")), "spend.jsonl");
const dev = { NODE_ENV: "development" };

describe("slugs", () => {
  it("folds case, accents and punctuation", () => {
    expect(slugify("Tan Howe Liang")).toBe("tan-howe-liang");
    expect(slugify("  Zoë  O’Neill-Lim ")).toBe("zoe-oneill-lim");
    expect(slugify("李光耀")).toBe("");
  });
  it("de-duplicates against existing lives and reserved routes", () => {
    const taken = new Set(["jack-sim", "jack-sim-2"]);
    expect(uniqueSlug("Jack Sim", (s) => taken.has(s))).toBe("jack-sim-3");
    expect(uniqueSlug("Create", () => false)).toBe("create-2");
    expect(uniqueSlug("李光耀", () => false)).toBe("life");
  });
});

describe("input", () => {
  it("trims and accepts a plain name and hint", () => {
    expect(validateInput("  Tan   Howe Liang ", " weightlifter ")).toEqual({ ok: true, value: { name: "Tan Howe Liang", hint: "weightlifter" } });
  });
  it("refuses empty, long, letterless and link-bearing names", () => {
    expect(validateInput("", "").ok).toBe(false);
    expect(validateInput("x".repeat(81), "").ok).toBe(false);
    expect(validateInput("x".repeat(80), "").ok).toBe(true);
    expect(validateInput("1234", "").ok).toBe(false);
    expect(validateInput("see https://evil.example", "").ok).toBe(false);
    expect(validateInput("<script>", "").ok).toBe(false);
    expect(validateInput(42, "").ok).toBe(false);
  });
  it("keeps the hint to one short line", () => {
    expect(validateInput("Jack Sim", "y".repeat(121)).ok).toBe(false);
  });
  it("checks photo size, declared type and the real bytes", () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 0]);
    const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
    expect(sniffImage(jpeg)).toBe("image/jpeg");
    expect(sniffImage(png)).toBe("image/png");
    expect(sniffImage(webp)).toBe("image/webp");
    expect(validatePhoto({ type: "image/jpeg", size: 100, bytes: jpeg }).ok).toBe(true);
    expect(validatePhoto({ type: "image/jpeg", size: 8 * 1024 * 1024 + 1, bytes: jpeg }).ok).toBe(false);
    expect(validatePhoto({ type: "image/gif", size: 100, bytes: jpeg }).ok).toBe(false);
    expect(validatePhoto({ type: "image/png", size: 100, bytes: new TextEncoder().encode("<svg onload=x>") }).ok).toBe(false);
  });
});

describe("guard rails", () => {
  const ok = { entries: [] as Entry[], left: 100 };
  it("are on in development and off in production unless ALLOW_CREATE=1", () => {
    expect(createEnabled(dev)).toBe(true);
    expect(createEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(createEnabled({ NODE_ENV: "production", ALLOW_CREATE: "1" })).toBe(true);
    expect(preflight({ ...ok, env: { NODE_ENV: "production" } })?.status).toBe(403);
    expect(preflight({ ...ok, env: { NODE_ENV: "production", ALLOW_CREATE: "1" } })).toBeNull();
  });
  it("need the passcode when CREATE_TOKEN is set", () => {
    expect(tokenOk(undefined, {})).toBe(true);
    expect(tokenOk("nope", { CREATE_TOKEN: "sesame" })).toBe(false);
    expect(tokenOk("sesame", { CREATE_TOKEN: "sesame" })).toBe(true);
    expect(preflight({ ...ok, env: { ...dev, CREATE_TOKEN: "sesame" }, token: "x" })?.status).toBe(401);
  });
  it("run one life at a time", () => {
    expect(preflight({ ...ok, env: dev, busy: "tan-howe-liang" })?.status).toBe(409);
  });
  it("refuse when the event budget's headroom is under the minimum", () => {
    expect(preflight({ ...ok, env: dev, left: MIN_HEADROOM - 0.01 })?.status).toBe(402);
    expect(preflight({ ...ok, env: dev, left: MIN_HEADROOM })).toBeNull();
  });
  it("let a rehearsal through whatever the budget, but never in production", () => {
    expect(preflight({ ...ok, env: dev, left: 0, mock: true })).toBeNull();
    expect(preflight({ ...ok, env: { NODE_ENV: "production", ALLOW_CREATE: "1" }, mock: true })?.status).toBe(403);
  });
});

describe("daily cap", () => {
  const now = new Date(2026, 9, 30, 15, 0);
  const at = (d: Date) => d.toISOString();
  const today = new Date(2026, 9, 30, 9, 0), yesterday = new Date(2026, 9, 29, 23, 0);
  const rows: Entry[] = [
    { at: at(today), kind: "image", usd: 4, job: "create:a" },
    { at: at(today), kind: "spark", usd: 3, job: "create:b" },
    { at: at(today), kind: "image", usd: 50 },
    { at: at(today), kind: "sam", usd: 9, job: "other" },
    { at: at(yesterday), kind: "image", usd: 9, job: "create:c" },
  ];
  it("counts only today's /create spend, by its ledger tag", () => {
    expect(spentToday(rows, now)).toBe(7);
  });
  it("defaults to $10 and reads CREATE_DAILY_USD", () => {
    expect(dailyCap({})).toBe(10);
    expect(dailyCap({ CREATE_DAILY_USD: "25" })).toBe(25);
    expect(dailyCap({ CREATE_DAILY_USD: "lots" })).toBe(10);
  });
  it("refuses a life whose ceiling would pass the cap", () => {
    expect(preflight({ entries: rows, left: 100, env: dev, now })).toBeNull();
    expect(preflight({ entries: rows, left: 100, env: { ...dev, CREATE_DAILY_USD: String(7 + LIFE_CEILING - 0.01) }, now })?.status).toBe(429);
  });
});

describe("per-life ceiling in the budget guard", () => {
  it("tags ledger rows with the job and refuses a call that could pass the ceiling", async () => {
    const f = ledger();
    const seen: Entry[] = [];
    await withScope({ job: "create:x", limit: 0.05, onSpend: (e) => seen.push(e) }, async () => {
      await guard("image", 0.01, async () => "ok", () => 0.01, "plate", f);
      record({ kind: "manual", usd: 0.035 }, f);
      let sent = false;
      await expect(guard("image", 0.01, async () => (sent = true), () => 0.01, "plate", f)).rejects.toBeInstanceOf(BudgetError);
      expect(sent).toBe(false);
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ job: "create:x", usd: 0.01 });
    // Outside the scope the same call goes through, untagged.
    await guard("image", 0.01, async () => "ok", () => 0.01, "plate", f);
    expect(spent(f)).toBeCloseTo(0.055);
  });
});

describe("stage helpers", () => {
  it("fit captions to the word limit, at a sentence end when there is one", () => {
    const long = `${"word ".repeat(12).trim()}. ${"more ".repeat(30).trim()}.`;
    expect(fitCaption(long).split(/\s+/).length).toBeLessThanOrEqual(30);
    expect(fitCaption(long).endsWith(".")).toBe(true);
    expect(fitCaption("Short one.")).toBe("Short one.");
  });
  it("runs a pool at most n at a time", async () => {
    let live = 0, most = 0;
    await pool([1, 2, 3, 4, 5, 6, 7], 3, async () => {
      most = Math.max(most, ++live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
    });
    expect(most).toBe(3);
  });
});

describe("frontispiece framing", () => {
  it("crops to the mask's bounds plus a margin, 900 wide, mask and image together", async () => {
    const { default: sharp } = await import("sharp");
    const { cropToMask } = await import("../pipeline/portrait");
    const w = 200, h = 100;
    const img = await sharp({ create: { width: w, height: h, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const mask = new Uint8Array(w * h);
    for (let y = 40; y < 60; y++) for (let x = 80; x < 120; x++) mask[y * w + x] = 1;
    const out = await cropToMask(img, mask, w, h, 0);
    const meta = await sharp(out.img).metadata();
    expect(meta.width).toBe(900);
    expect(meta.height).toBe(450);
    expect(out.mask.length).toBe(900 * 450);
    expect(out.mask[225 * 900 + 450]).toBe(1);
  });
});

describe("rehearsals and per-visitor limits", () => {
  it("run without the on switch or the passcode, but wait for a busy server", async () => {
    const { preflight } = await import("../pipeline/jobs/guard");
    const prodMock = { NODE_ENV: "production", CREATE_MOCK: "1", CREATE_TOKEN: "secret" };
    expect(preflight({ entries: [], left: 0, env: prodMock, mock: true })).toBeNull();
    expect(preflight({ entries: [], left: 0, env: prodMock, mock: true, busy: "x" })?.status).toBe(409);
    expect(preflight({ entries: [], left: 100, env: { ...prodMock, ALLOW_CREATE: "1" }, token: "nope" })?.status).toBe(401);
  });
  it("allow two real lives per visitor per day", async () => {
    const { IpLimit } = await import("../pipeline/jobs/guard");
    const lim = new IpLimit(() => 2);
    const day = new Date(2026, 9, 30, 10), next = new Date(2026, 9, 31, 9);
    expect(lim.check("1.2.3.4", day)).toBeNull();
    lim.hit("1.2.3.4", day);
    lim.hit("1.2.3.4", day);
    expect(lim.check("1.2.3.4", day)?.status).toBe(429);
    expect(lim.check("5.6.7.8", day)).toBeNull();
    expect(lim.check("1.2.3.4", next)).toBeNull();
  });
  it("trust X-Forwarded-For only behind a proxy (TRUST_PROXY=1)", async () => {
    const { IpLimit, clientIp, GLOBAL_BUCKET } = await import("../pipeline/jobs/guard");
    const proxied = { TRUST_PROXY: "1" };
    expect(clientIp(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }), proxied)).toBe("9.9.9.9");
    expect(clientIp(new Headers({ "x-real-ip": "8.8.8.8" }), proxied)).toBe("8.8.8.8");
    expect(clientIp(new Headers(), proxied)).toBe(GLOBAL_BUCKET);
    // Without a trusted proxy the headers are ignored: the socket address, else one shared bucket.
    expect(clientIp(new Headers({ "x-forwarded-for": "9.9.9.9" }), {})).toBe(GLOBAL_BUCKET);
    expect(clientIp(new Headers({ "x-real-ip": "8.8.8.8" }), { TRUST_PROXY: "0" })).toBe(GLOBAL_BUCKET);
    expect(clientIp(new Headers({ "x-forwarded-for": "9.9.9.9" }), {}, "203.0.113.7")).toBe("203.0.113.7");
    // So a visitor who rotates a spoofed header still hits the limit.
    const lim = new IpLimit(() => 2);
    const day = new Date(2026, 9, 30, 10);
    for (const fake of ["1.1.1.1", "2.2.2.2"]) lim.hit(clientIp(new Headers({ "x-forwarded-for": fake }), {}), day);
    const third = lim.check(clientIp(new Headers({ "x-forwarded-for": "3.3.3.3" }), {}), day);
    expect(third?.status).toBe(429);
    expect(third?.error).toMatch(/This server makes 2 new lives a day/);
  });
});

describe("verify verdicts", () => {
  it("read the last OK or WRONG, past any narration", async () => {
    const { parseVerdict } = await import("../pipeline/stages");
    expect(parseVerdict("OK | matches NLB")).toEqual({ verdict: "ok", note: "matches NLB" });
    expect(parseVerdict("Checking dates now.Timing confirms it.WRONG | Tokyo came first")).toEqual({ verdict: "disputed", note: "Tokyo came first" });
    expect(parseVerdict("no verdict at all").verdict).toBe("disputed");
  });
});
