/**
 * Builds the Claude Design design-system bundle into design-system/dist: one self-contained
 * preview HTML per card (first line `<!-- @dsCard group="…" -->`), plus README.md describing
 * the system. Pushed to claude.ai/design with the DesignSync tool.
 */
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Story } from "../src/schema";
import { ERAS, FONT_HREF } from "../src/eras";
import { MOTIFS, motifSvg } from "../src/motifs";
import { DIRECTIONS, stillHtml } from "../src/render/frame";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "design-system", "dist");
const css = (await readFile(join(ROOT, "src/styles/lim.css"), "utf8")) + (await readFile(join(ROOT, "src/styles/pages.css"), "utf8"));
const load = async (slug: string) => Story.parse(JSON.parse(await readFile(join(ROOT, "stories", slug, "story.json"), "utf8")));
const [jack, lky, jos] = await Promise.all(["jack-sim", "lee-kuan-yew", "joseph-schooling"].map(load));

const page = (group: string, title: string, body: string, extra = "") => `<!-- @dsCard group="${group}" -->
<!doctype html><html lang="en" data-page="ds"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<link rel="stylesheet" href="${FONT_HREF}"><style>${css}
body{padding:28px;background:#f3eee2}.ds-h{font:500 12px var(--mono);letter-spacing:.18em;text-transform:uppercase;margin:0 0 14px}.lim-still{margin:0}.lim-still .lim-stage{aspect-ratio:16/9}${extra}</style></head>
<body><p class="ds-h">Lives in Motion · ${title}</p>${body}</body></html>`;

const cards: Record<string, string> = {};

for (const d of DIRECTIONS) {
  cards[`directions/${d.id}.html`] = page("Directions", d.name, `${stillHtml(jack, 3, d.id)}<p style="max-width:60ch">${d.line}</p>`);
}
cards["directions/era-shift-across-eras.html"] = page(
  "Directions",
  "Era Shift across three eras",
  `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">${[0, 4, 5].map((i) => stillHtml(lky, i, "era-shift")).join("")}</div>`,
  ".lim-cap-text,.lim-chips{display:none}",
);
cards["components/layers-xray.html"] = page("Components", "Layers x-ray (SAM 3.1 cut-outs)", stillHtml(jos, 4, "paper-theatre", true), ".lim-still .lim-stage{overflow:visible}");
cards["components/gallery-card.html"] = page(
  "Components",
  "Gallery cards",
  `<div class="g-wall" style="padding:0">${[jack, lky, jos].map((s, i) => `<a class="g-card">${stillHtml(s, [3, 4, 4][i], DIRECTIONS[i].id)}<div class="g-meta"><span class="g-no">0${i + 1}</span><h2>${s.name}</h2><p>${s.tagline}</p></div></a>`).join("")}</div>`,
  ".g-card .lim-caption{display:none}",
);
cards["foundations/era-presets.html"] = page(
  "Foundations",
  "Era presets",
  `<div class="s-era-grid">${ERAS.map((e) => `<div class="s-era" style="--paper:${e.paper};--ink:${e.ink};--accent:${e.accent};--accent2:${e.accent2};--display:${e.display.replace(/"/g, "'")};--body:${e.body.replace(/"/g, "'")}"><div class="s-era-art">${motifSvg("toilet", e)}</div><h3>${e.label}</h3><p class="s-era-years">${e.from}–${e.to > 2050 ? "now" : e.to}</p><div class="s-swatches">${[e.paper, e.ink, e.accent, e.accent2].map((c) => `<span style="background:${c}" title="${c}"></span>`).join("")}</div><p class="s-era-print">${e.print}</p><p class="s-era-ease">ease: ${e.ease} · ${e.duration}s</p></div>`).join("")}</div>`,
);
const era = ERAS[3];
cards["foundations/motif-library.html"] = page(
  "Foundations",
  "Cut-paper motif library",
  `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px">${Object.keys(MOTIFS).map((m) => `<figure style="margin:0;background:${era.paper};padding:10px"><div style="height:90px;display:grid;place-items:center">${motifSvg(m, era, m === "calendar" ? "19 NOV" : m === "scoreboard" ? "50.39" : "TEXT")}</div><figcaption style="font:11px var(--mono)">${m}</figcaption></figure>`).join("")}</div>`,
  "figure svg{max-height:90px;width:auto;max-width:100%;filter:drop-shadow(3px 4px 0 rgba(0,0,0,.18))}",
);

await rm(OUT, { recursive: true, force: true });
for (const [path, html] of Object.entries(cards)) {
  await mkdir(join(OUT, path, ".."), { recursive: true });
  await writeFile(join(OUT, path), html);
}
await writeFile(
  join(OUT, "README.md"),
  `# Lives in Motion design system

Scroll-driven, era-styled biographies of Singaporeans. One stage, three directions, six era presets.

- **Directions:** ${DIRECTIONS.map((d) => `${d.name}: ${d.line}`).join(" ")}
- **Era presets** set palette, display and body type, grain and motion easing by the scene's year; the same tokens drive the Muse Image prompt.
- **Rules:** figures are silhouettes or seen from behind; every scene cites a source; captions under 30 words; reduced motion gets stills.
- **Source of truth:** the lives-in-motion repo (src/eras.ts, src/motifs.ts, src/styles/lim.css). Edit there, rebuild with \`pnpm design-system\`.
`,
);
console.log(Object.keys(cards).length + 1, "files →", OUT);
