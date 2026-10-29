import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { Direction, Layer, Story } from "../schema";
import { eraFor } from "../eras";
import { applyVars, captionEl, DIRECTIONS, h, lifespan, sceneEl } from "./frame";

gsap.registerPlugin(ScrollTrigger);

const FROM: Record<Layer["enter"], (depth: number) => gsap.TweenVars> = {
  rise: (d) => ({ yPercent: 40 + 80 * (1 - d), opacity: 0 }),
  "slide-left": (d) => ({ xPercent: -140 - 80 * d, opacity: 0 }),
  "slide-right": (d) => ({ xPercent: 140 + 80 * d, opacity: 0 }),
  drop: () => ({ yPercent: -160, opacity: 0, rotation: -6 }),
  fade: () => ({ opacity: 0, scale: 1.04 }),
  unfold: () => ({ scaleY: 0, transformOrigin: "50% 100%" }),
};

/** Seconds of timeline per scene: enter, hold (parallax drift), exit. Scrubbed by scroll. */
const ENTER = 0.4;
const HOLD = 0.4;
const EXIT = 0.3;

export function renderStory(root: HTMLElement, story: Story, direction: Direction) {
  document.documentElement.dataset.direction = direction;
  root.className = `lim-story d-${direction}`;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const hero = h("header", { class: "lim-hero" });
  hero.innerHTML = `<p class="lim-kicker">Lives in Motion · Singapore</p>
    <h1 class="lim-name">${story.name}</h1>
    <p class="lim-dates">${lifespan(story)}</p>
    <p class="lim-tagline">${story.tagline}</p>
    <p class="lim-cue">Scroll to begin</p>`;
  applyVars(hero, eraFor(story.scenes[0].year));

  const wrap = h("section", { class: "lim-track", style: `--scenes:${story.scenes.length}` });
  const stage = h("div", { class: "lim-stage" });
  stage.append(h("div", { class: "lim-frame" }));
  const scenes = story.scenes.map((s, i) => sceneEl(s, i));
  const caps = story.scenes.map((s, i) => captionEl(s, i));
  stage.append(...scenes, ...caps);

  const rail = h("nav", { class: "lim-rail", "aria-label": "Timeline" });
  rail.innerHTML = story.scenes
    .map((s, i) => `<button data-i="${i}" title="${s.title}"><span>${s.year}</span></button>`)
    .join("");
  stage.append(rail);

  const tools = h("div", { class: "lim-tools" });
  tools.innerHTML = `<button class="lim-xray" aria-pressed="false" title="Show the layers SAM 3.1 cut out">Layers</button>
    <label class="lim-switch">Style <select>${DIRECTIONS.map((d) => `<option value="${d.id}" ${d.id === direction ? "selected" : ""}>${d.name}</option>`).join("")}</select></label>`;
  stage.append(tools);
  wrap.append(stage);

  const foot = h("footer", { class: "lim-foot" });
  const allSources = story.scenes.flatMap((s) => s.sources.map((src) => ({ ...src, year: s.year })));
  foot.innerHTML = `<h3>Sources</h3><ol>${allSources.map((s) => `<li>${s.year} · <a href="${s.url}" target="_blank" rel="noopener">${s.label}</a></li>`).join("")}</ol>
    <p class="lim-ai-note">${story.generated ? "Scenes illustrated with Muse Image and cut into layers with SAM 3.1; facts researched with Muse Spark and checked against the sources above." : "Scenes use the built-in cut-paper motifs (no generated images yet). Figures are silhouettes by design."}</p>
    <p><a href="./">← All lives</a> · <a href="./styles.html">Design directions</a></p>`;

  root.replaceChildren(hero, wrap, foot);

  tools.querySelector("select")!.addEventListener("change", (e) => {
    const url = new URL(location.href);
    url.searchParams.set("d", (e.target as HTMLSelectElement).value);
    location.href = url.toString();
  });
  const xray = tools.querySelector<HTMLButtonElement>(".lim-xray")!;
  xray.addEventListener("click", () => {
    const on = stage.classList.toggle("xray");
    xray.setAttribute("aria-pressed", String(on));
  });

  let active = -1;
  const setActive = (i: number) => {
    if (i === active) return;
    active = i;
    scenes.forEach((s, k) => s.classList.toggle("is-active", k === i));
    caps.forEach((c, k) => c.classList.toggle("is-active", k === i));
    rail.querySelectorAll("button").forEach((b, k) => b.classList.toggle("is-active", k === i));
    const era = eraFor(story.scenes[i].year);
    applyVars(document.documentElement, era);
    stage.dataset.era = era.id;
  };
  setActive(0);

  if (reduced) {
    root.classList.add("lim-static");
    scenes.forEach((s) => s.classList.add("is-active"));
    caps.forEach((c) => c.classList.add("is-active"));
    return { goTo: (i: number) => scenes[i].scrollIntoView() };
  }

  const tl = gsap.timeline({ defaults: { ease: "none" } });
  const unit = ENTER + HOLD + EXIT;
  story.scenes.forEach((scene, i) => {
    const era = eraFor(scene.year);
    const t0 = i * unit;
    const layerEls = [...scenes[i].querySelectorAll<HTMLElement>(".lim-layer")];
    const inners = layerEls.map((l) => l.querySelector<HTMLElement>(".lim-layer-inner")!);
    const last = i === story.scenes.length - 1;

    tl.fromTo(scenes[i], { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.12 }, i === 0 ? 0 : t0);
    inners.forEach((el, k) => {
      const depth = Number(layerEls[k].dataset.depth);
      const enter = scene.layers.find((l) => l.concept === layerEls[k].dataset.concept)?.enter ?? "rise";
      // Back layers settle first; the era's easing gives each decade its own weight.
      tl.fromTo(
        el,
        FROM[enter](depth),
        { xPercent: 0, yPercent: 0, opacity: 1, scale: 1, scaleY: 1, rotation: 0, duration: ENTER * 0.75, ease: era.ease },
        t0 + (i === 0 ? 0 : 0.05) + depth * ENTER * 0.25,
      );
      // Parallax drift while the scene holds: nearer layers travel further.
      tl.to(el, { xPercent: `-=${4 + depth * 14}`, duration: HOLD + (last ? EXIT : 0) }, t0 + ENTER);
      if (!last) {
        const side = direction === "paper-theatre" ? (k % 2 ? 1 : -1) : 0;
        tl.to(
          el,
          { xPercent: `+=${side * (60 + depth * 120)}`, yPercent: side ? 0 : -20 - depth * 60, opacity: 0, duration: EXIT, ease: "power2.in" },
          t0 + ENTER + HOLD,
        );
      }
    });
    if (!last) tl.to(scenes[i], { autoAlpha: 0, duration: 0.05 }, t0 + unit - 0.02);
  });

  ScrollTrigger.create({
    trigger: wrap,
    start: "top top",
    end: "bottom bottom",
    scrub: 0.6,
    animation: tl,
    onUpdate: (st) => setActive(Math.min(story.scenes.length - 1, Math.floor((st.progress * tl.duration()) / unit))),
  });

  const goTo = (i: number, behavior: ScrollBehavior = "smooth") => {
    const top = wrap.offsetTop + ((i * unit + ENTER + 0.05) / tl.duration()) * (wrap.offsetHeight - innerHeight);
    scrollTo({ top, behavior });
  };
  rail.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => goTo(Number(b.dataset.i))));
  return { goTo };
}
