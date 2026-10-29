/** Screenshots of the running dev server with the installed Chrome: pnpm shoot [baseUrl] [outDir] */
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const base = process.argv[2] ?? "http://localhost:5173";
const out = process.argv[3] ?? "docs/shots/raw";
const SHOTS: [string, string, number?][] = [
  ["gallery", "index.html", 2400],
  ["styles", "styles.html", 3200],
  ["jack-sim-paper-theatre-s4", "story.html?p=jack-sim&s=4"],
  ["jack-sim-paper-theatre-s1", "story.html?p=jack-sim&s=1"],
  ["jack-sim-living-archive-s6", "story.html?p=jack-sim&s=6&d=living-archive"],
  ["lee-kuan-yew-era-shift-s5", "story.html?p=lee-kuan-yew&s=5&d=era-shift"],
  ["lee-kuan-yew-era-shift-s6", "story.html?p=lee-kuan-yew&s=6&d=era-shift"],
  ["joseph-schooling-paper-theatre-s5", "story.html?p=joseph-schooling&s=5"],
  ["joseph-schooling-layers-s5", "story.html?p=joseph-schooling&s=5&layers=1"],
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const [name, path, full] of SHOTS) {
  await page.goto(`${base}/${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);
  if (full) await page.setViewportSize({ width: 1440, height: full });
  await page.screenshot({ path: `${out}/${name}.png` });
  if (full) await page.setViewportSize({ width: 1440, height: 900 });
  console.log(name);
}
await browser.close();
