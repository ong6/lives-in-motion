/**
 * Screenshots of a running server with the installed Chrome: pnpm shoot [baseUrl] [outDir]
 *
 * The book is read a page at a time, so a book shot opens its spread by URL (#p=N: 0 the cover,
 * 2 the frontispiece, 3 Chapter I, one spread per chapter, then the notes) and waits for the turn
 * and the film to settle. A shot can then press keys (L opens the Layers view, → turns a page)
 * or click a button, and wait before the picture is taken.
 */
import { chromium, type Page } from "playwright-core";
import { mkdir, readFile } from "node:fs/promises";
import { plan } from "../components/book/pagination";

const base = process.argv[2] ?? "http://localhost:3000";
const out = process.argv[3] ?? "docs/shots";

interface Shot {
  name: string;
  path: string;
  /** Run after the page settles, before the picture. */
  act?: (page: Page) => Promise<void>;
  /** Milliseconds to wait after load (or after `act`). */
  wait?: number;
  fullPage?: boolean;
}

const SHOTS: Shot[] = [
  { name: "home", path: "/" },
  { name: "home-making", path: "/#making" },
  { name: "book-jack-sim-2001", path: "/jack-sim#p=6", wait: 4500 },
  { name: "layers-jack-sim-2001", path: "/jack-sim#p=6", wait: 4500, act: async (p) => (await p.keyboard.press("l"), await p.waitForTimeout(2500)) },
  { name: "book-joseph-schooling-2016", path: "/joseph-schooling#p=8", wait: 4500 },
  // The notes spread: the notes and the "On the pictures" page, whose copy follows the book's provenance.
  { name: "notes-jack-sim", path: "/jack-sim#p=10", wait: 3000 },
  { name: "notes-tan-howe-liang", path: "/tan-howe-liang#p=10", wait: 3000 },
  { name: "book-ah-ma-sample-title", path: "/ah-ma-sample#p=2", wait: 4000 },
  { name: "notes-ah-ma-sample", path: "/ah-ma-sample#p=10", wait: 3000 },
  { name: "home-full", path: "/", wait: 2500, fullPage: true },
  { name: "family", path: "/family", wait: 1500, fullPage: true },
  { name: "family-record", path: "/family/ah-ma-sample", wait: 1500, fullPage: true },
  { name: "create", path: "/create", wait: 1500, fullPage: true },
  // The book change: from Jack Sim's notes, one turn closes his book and opens the next.
  { name: "book-change", path: "/jack-sim#p=10", wait: 3000, act: async (p) => (await p.keyboard.press("ArrowRight"), await p.waitForTimeout(1300)) },
  {
    name: "create-rehearsal",
    path: "/create",
    wait: 1500,
    act: async (p) => {
      await p.getByRole("button", { name: /rehearse/i }).first().click();
      // A rehearsal replays a whole life, Muse Wonder's Direct step included, in about a minute and a half.
      await p.getByText(/Rehearsal finished/i).waitFor({ timeout: 180_000 });
      await p.waitForTimeout(1500);
    },
    fullPage: true,
  },
  {
    name: "family-replay",
    path: "/family",
    wait: 1500,
    act: async (p) => {
      await p.getByRole("button", { name: /try the sample/i }).click();
      // The replay compresses the sample book's real run to about a minute.
      await p.getByText(/Sample replayed/i).waitFor({ timeout: 180_000 });
      await p.waitForTimeout(1500);
    },
    fullPage: true,
  },
];

/**
 * `book:<slug>` as the shot list: every spread of that life's book, named by spread and kind
 * (chapter spreads add the chapter's treatment), plus the Layers view on its first photo and plate.
 */
async function bookShots(slug: string): Promise<Shot[]> {
  const story = JSON.parse(await readFile(`stories/${slug}/story.json`, "utf8"));
  const p = plan(story);
  const shots: Shot[] = [];
  p.kinds.forEach((kind, sp) => {
    if (kind === "cover" || kind === "endpapers" || kind === "endpapersBack" || kind === "closed") return;
    const sc = p.scene[sp] >= 0 && kind === "chapter" ? story.scenes[p.scene[sp]] : undefined;
    const name = `${slug}-${String(sp).padStart(2, "0")}-${kind}${sc ? `-${sc.treatment}` : ""}`;
    shots.push({ name, path: `/${slug}#p=${sp}`, wait: 5000 });
  });
  for (const t of ["photo", "theatre"]) {
    const j = story.scenes.findIndex((s: { treatment: string; plate?: string; photo?: unknown }) => s.treatment === t && (s.plate || s.photo));
    if (j >= 0) shots.push({ name: `${slug}-layers-${t}`, path: `/${slug}#p=${p.spreadOf[j]}`, wait: 5000, act: async (pg) => (await pg.keyboard.press("l"), await pg.waitForTimeout(3200)) });
  }
  return shots;
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const book = process.argv[4]?.startsWith("book:") ? process.argv[4].slice(5) : undefined;
if (book) SHOTS.splice(0, SHOTS.length, ...(await bookShots(book)));
const only = book ? undefined : process.argv[4]?.split(",");
for (const shot of SHOTS) {
  if (only && !only.includes(shot.name)) continue;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base + shot.path, { waitUntil: "networkidle" });
  // The dev server's "N" badge isn't part of the site.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForTimeout(shot.wait ?? 1600);
  if (shot.act) await shot.act(page);
  await page.screenshot({ path: `${out}/${shot.name}.png`, fullPage: shot.fullPage });
  await page.close();
  console.log(shot.name);
}
await browser.close();
