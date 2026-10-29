import type { Direction, Layer, Scene, Story } from "../schema";
import { eraFor, eraVars, type Era } from "../eras";
import { motifSvg } from "../motifs";

export const DIRECTIONS: { id: Direction; name: string; line: string }[] = [
  { id: "paper-theatre", name: "Paper Theatre", line: "Each life plays on a shophouse stage; the layers are paper puppets." },
  { id: "living-archive", name: "Living Archive", line: "A museum catalogue: plates, labels and the print style of each era." },
  { id: "era-shift", name: "Era Shift", line: "The whole interface changes type, colour and grain as the decades pass." },
];

// Builders return HTML strings so the same markup renders in the browser and in Node
// (the Claude Design bundle in design-system/build.ts).

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
export const varStyle = (era: Era) => Object.entries(eraVars(era)).map(([k, v]) => `${k}:${v}`).join(";").replace(/"/g, "'");

function layerHtml(layer: Layer, era: Era): string {
  const art = layer.src
    ? `<img src="${attr(layer.src)}" alt="" loading="lazy" decoding="async">`
    : motifSvg(layer.motif!, era, layer.text);
  return `<div class="lim-layer" data-concept="${attr(layer.concept)}" data-depth="${layer.depth}" style="left:${layer.x}%;top:${layer.y}%;width:${layer.w}%;--depth:${layer.depth};z-index:${Math.round(layer.depth * 100)}"><div class="lim-layer-inner">${art}</div></div>`;
}

export function sceneHtml(scene: Scene, index: number, active = false): string {
  const era = eraFor(scene.year);
  const layers = [...scene.layers].sort((a, b) => a.depth - b.depth).map((l) => layerHtml(l, era)).join("");
  return `<div class="lim-scene${active ? " is-active" : ""}" data-index="${index}" data-era="${era.id}" style="${varStyle(era)}"><div class="lim-backdrop"></div><div class="lim-grain"></div><div class="lim-layers">${layers}</div><div class="lim-plate-no">Pl. ${ROMAN[index] ?? index + 1}</div></div>`;
}

export function captionHtml(scene: Scene, index: number, active = false): string {
  const era = eraFor(scene.year);
  const chips = scene.sources.map((s) => `<a class="lim-chip" href="${attr(s.url)}" target="_blank" rel="noopener">${s.label}</a>`).join("");
  return `<div class="lim-caption${active ? " is-active" : ""}" data-index="${index}" style="${varStyle(era)}"><div class="lim-cap-meta"><span class="lim-cap-no">No. ${String(index + 1).padStart(2, "0")}</span><span class="lim-cap-era">${era.label}</span></div><div class="lim-cap-year">${scene.year}</div><h2 class="lim-cap-title">${scene.title}</h2><p class="lim-cap-text">${scene.caption}</p><div class="lim-chips">${chips}</div></div>`;
}

/** A finished still frame of one scene in one direction: gallery covers, the showcase, the design bundle. */
export function stillHtml(story: Story, sceneIndex: number, direction: Direction, xray = false): string {
  const scene = story.scenes[sceneIndex];
  return `<figure class="lim-still d-${direction}"><div class="lim-stage${xray ? " xray" : ""}" data-era="${eraFor(scene.year).id}" style="${varStyle(eraFor(scene.year))}"><div class="lim-frame"></div>${sceneHtml(scene, sceneIndex, true)}${captionHtml(scene, sceneIndex, true)}</div></figure>`;
}

export function lifespan(story: Story): string {
  return story.died ? `${story.born}–${story.died.slice(0, 4)}` : `b. ${story.born}`;
}

// ---- DOM helpers (browser only) ----

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ""): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (html) el.innerHTML = html;
  return el;
}

export function fromHtml(html: string): HTMLElement {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

export function applyVars(el: HTMLElement, era: Era) {
  for (const [k, v] of Object.entries(eraVars(era))) el.style.setProperty(k, v);
}

export const sceneEl = (scene: Scene, i: number) => fromHtml(sceneHtml(scene, i));
export const captionEl = (scene: Scene, i: number) => fromHtml(captionHtml(scene, i));
export const stillFrame = (story: Story, i: number, d: Direction) => fromHtml(stillHtml(story, i, d));
