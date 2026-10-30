/** Screenshots of a running server with the installed Chrome: pnpm shoot [baseUrl] [outDir] */
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const base = process.argv[2] ?? "http://localhost:3000";
const out = process.argv[3] ?? "docs/shots/raw";

/** [name, path, scroll fraction of the page (0–1), viewport height] */
const SHOTS: [string, string, number, number?][] = [
  ["home", "/", 0, 900],
  ["home-lives", "/", 0.38, 900],
  ["jack-sim-intro", "/jack-sim", 0.13],
  ["jack-sim-s4", "/jack-sim", 0.56],
  ["lee-kuan-yew-s5", "/lee-kuan-yew", 0.66],
  ["joseph-schooling-s5", "/joseph-schooling", 0.66],
  ["mobile-story", "/jack-sim", 0.5, 844],
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
for (const [name, path, frac, h] of SHOTS) {
  const mobile = name.startsWith("mobile");
  const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1440, height: h ?? 900 } });
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.evaluate((f) => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * f), frac);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.close();
  console.log(name);
}
await browser.close();
