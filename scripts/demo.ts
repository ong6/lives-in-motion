/**
 * Records the demo's screen, one segment per narration clip: tsx scripts/demo.ts <baseUrl> <audioDir> <outDir>
 * Each segment's length is its clip's plus PAD; frames come from Chrome's screencast with their timestamps.
 */
import { chromium, type Page } from "playwright-core";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const [base, audio, out] = process.argv.slice(2);
const PAD = 0.6;
const sleep = (p: Page, s: number) => p.waitForTimeout(s * 1000);
const wheel = async (p: Page, px: number, secs: number) => {
  const steps = Math.round(secs * 20);
  for (let i = 0; i < steps; i++) (await p.mouse.wheel(0, px / steps), await p.waitForTimeout(50));
};

interface Seg { name: string; path: string; ready?: (p: Page) => Promise<void>; act?: (p: Page) => Promise<void> }
const SEGS: Seg[] = [
  { name: "hero", path: "/", act: async (p) => { await sleep(p, 6); await p.mouse.move(1300, 500, { steps: 30 }); } },
  { name: "shelf", path: "/", ready: async (p) => { await p.evaluate(() => document.getElementById("shelf")?.scrollIntoView()); await sleep(p, 2); },
    act: async (p) => { await p.mouse.move(400, 650, { steps: 40 }); await sleep(p, 3); await p.mouse.move(1000, 650, { steps: 60 }); await sleep(p, 3); await p.mouse.move(1500, 650, { steps: 60 }); } },
  { name: "open", path: "/jack-sim", act: async (p) => { await sleep(p, 3); await p.keyboard.press("ArrowRight"); await sleep(p, 3); await p.keyboard.press("ArrowRight"); } },
  { name: "plate", path: "/jack-sim#c=1" },
  { name: "layers", path: "/jack-sim#c=1", ready: async (p) => sleep(p, 4), act: async (p) => { await sleep(p, 1.5); await p.keyboard.press("l"); } },
  { name: "photo", path: "/jack-sim#c=7" },
  { name: "notes", path: "/jack-sim#p=16", ready: async (p) => sleep(p, 2) },
  { name: "making", path: "/#making", ready: async (p) => sleep(p, 2), act: async (p) => { await p.mouse.move(960, 600); await sleep(p, 2); await wheel(p, 900, 11); } },
  { name: "create", path: "/create", ready: async (p) => sleep(p, 1), act: async (p) => { await sleep(p, 1.5); await p.getByRole("button", { name: /rehearse/i }).first().click(); } },
  { name: "family", path: "/family", ready: async (p) => sleep(p, 1), act: async (p) => { await sleep(p, 1.5); await p.getByRole("button", { name: /try the sample/i }).click(); } },
  { name: "close", path: "/", ready: async (p) => sleep(p, 1) },
];

const browser = await chromium.launch({ channel: "chrome" });
for (const seg of SEGS) {
  if (process.argv[5] && !process.argv[5].split(",").includes(seg.name)) continue;
  const clip = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `${audio}/${seg.name}.wav`]).toString());
  const dur = clip + PAD;
  const dir = `${out}/frames/${seg.name}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(base + seg.path, { waitUntil: "load" });
  await seg.ready?.(page);
  const cdp = await page.context().newCDPSession(page);
  const frames: { f: string; t: number }[] = [];
  cdp.on("Page.screencastFrame", (e) => {
    const f = `${String(frames.length).padStart(6, "0")}.jpg`;
    writeFileSync(`${dir}/${f}`, Buffer.from(e.data, "base64"));
    frames.push({ f, t: Date.now() / 1000 });
    void cdp.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  const start = Date.now();
  const acting = seg.act?.(page) ?? Promise.resolve();
  await acting;
  const left = dur * 1000 - (Date.now() - start);
  if (left > 0) await page.waitForTimeout(left);
  await cdp.send("Page.stopScreencast");
  // A concat list with each frame held until the next; the last holds to the segment's end.
  const t0 = start / 1000;
  const first = Math.max(0, frames[0].t - t0);
  const lines = frames.map((x, i) => `file '${x.f}'\nduration ${Math.max(0.001, (i + 1 < frames.length ? frames[i + 1].t - x.t + (i ? 0 : first) : Math.max(0.05, dur - (x.t - t0)))).toFixed(4)}`);
  writeFileSync(`${dir}/list.txt`, `${lines.join("\n")}\nfile '${frames[frames.length - 1].f}'\n`);
  console.log(seg.name, dur.toFixed(1), "s", frames.length, "frames");
  await page.close();
}
await browser.close();
