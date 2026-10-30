/** Screenshots of a running server with the installed Chrome: pnpm shoot [baseUrl] [outDir] */
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const base = process.argv[2] ?? "http://localhost:3000";
const out = process.argv[3] ?? "docs/shots/raw";

/**
 * [name, path, scroll position, viewport height]. Home positions are fractions of the page;
 * story positions are in spreads' screen heights along the book (cover 0, title ≈ 2, Chapter I
 * ≈ 3.75, then 1.5 per chapter), read from the track's data-total.
 */
const SHOTS: [string, string, number, number?][] = [
  ["home", "/", 0],
  ["home-shelf", "/#shelf", -1],
  ["home-making", "/#making", -1],
  ["jack-sim-cover", "/jack-sim", 0],
  ["jack-sim-title", "/jack-sim", 2],
  ["jack-sim-s4", "/jack-sim", 3.75 + 1.5 * 3],
  ["jack-sim-notes", "/jack-sim", 3 + 1.5 * 7 + 0.8],
  ["lee-kuan-yew-arrive", "/lee-kuan-yew?from=turn", -1],
  ["lee-kuan-yew-s5", "/lee-kuan-yew", 3.75 + 1.5 * 4],
  ["joseph-schooling-s5", "/joseph-schooling", 3.75 + 1.5 * 4],
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
for (const [name, path, at, h] of SHOTS) {
  const page = await browser.newPage({ viewport: { width: 1440, height: h ?? 900 } });
  await page.goto(base + path, { waitUntil: "networkidle" });
  // -1: leave the page where it opened (an anchor, or a story opened at its title spread).
  if (at >= 0)
    await page.evaluate((at) => {
      const track = document.querySelector<HTMLElement>("[data-total]");
      const max = document.documentElement.scrollHeight - innerHeight;
      scrollTo(0, track ? track.offsetTop + (at / Number(track.dataset.total)) * (track.offsetHeight - innerHeight) : max * at);
    }, at);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.close();
  console.log(name);
}
await browser.close();
