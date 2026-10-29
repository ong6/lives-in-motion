import { boot } from "./common";
import { bySlug } from "../stories";
import { DIRECTIONS, h, stillFrame } from "../render/frame";
import { ERAS } from "../eras";
import { motifSvg } from "../motifs";

const app = boot();
document.documentElement.dataset.page = "styles";
const jack = bySlug("jack-sim");

const head = h("header", { class: "g-head" });
head.innerHTML = `<p class="g-kicker">Design directions</p><h1>One scene,<br/><em>three ways</em> to tell it.</h1>
  <p class="g-lede">The same moment, Jack Sim founding the World Toilet Organization in 2001, staged in each direction. Every story can switch between them; the era tokens below feed all three.</p>`;

const dirs = h("section", { class: "s-dirs" });
for (const d of DIRECTIONS) {
  const block = h("article", { class: "s-dir" });
  block.innerHTML = `<div class="s-dir-head"><h2>${d.name}</h2><p>${d.line}</p><a href="story.html?p=jack-sim&d=${d.id}">Play Jack Sim in ${d.name} →</a></div>`;
  block.append(stillFrame(jack, 3, d.id));
  dirs.append(block);
}

const eras = h("section", { class: "s-eras" });
eras.innerHTML = `<h2>Era presets</h2><p class="g-lede">A scene picks its preset from its year. Palette, type, grain and easing change; the toilet stays a toilet.</p>`;
const grid = h("div", { class: "s-era-grid" });
for (const e of ERAS) {
  const card = h("div", { class: "s-era", style: `--paper:${e.paper};--ink:${e.ink};--accent:${e.accent};--accent2:${e.accent2};--display:${e.display};--body:${e.body}` });
  card.innerHTML = `<div class="s-era-art">${motifSvg("toilet", e)}</div>
    <h3>${e.label}</h3><p class="s-era-years">${e.from}–${e.to > 2050 ? "now" : e.to}</p>
    <div class="s-swatches">${[e.paper, e.ink, e.accent, e.accent2].map((c) => `<span style="background:${c}" title="${c}"></span>`).join("")}</div>
    <p class="s-era-print">${e.print}</p><p class="s-era-ease">ease: ${e.ease} · ${e.duration}s</p>`;
  grid.append(card);
}
eras.append(grid);
app.replaceChildren(head, dirs, eras);
