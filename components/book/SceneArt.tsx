"use client";

import type { CSSProperties } from "react";
import type { Layer, Scene } from "@/lib/schema";
import { Overlay } from "./Overlay";
import { LineDrawing } from "../shared/LineDrawing";
import { ScrollVideo } from "./ScrollVideo";
import s from "./SceneArt.module.css";

/** A layer's box on the scene's square, and its depth for the CSS. */
export const place = (l: Layer): CSSProperties => ({
  left: `${l.x}%`,
  top: `${l.y}%`,
  width: `${l.w}%`,
  zIndex: Math.round(l.depth * 100),
  ["--depth" as string]: l.depth,
});

function Layers({ layers }: { layers: Layer[] }) {
  return layers.map((l) => (
    <div key={l.id} className={s.layer} style={place(l)} data-concept={l.concept}>
      {l.src ? <img src={l.src} alt="" /> : <Overlay kind={l.overlay!} text={l.text} />}
    </div>
  ));
}

const FILM_MS = 3500;

/** How long a scene's entrance runs once its page has turned, in ms. */
export function sceneDuration(scene: Scene): number {
  if (!scene.plate) return 900;
  if (scene.treatment === "line") return scene.video ? FILM_MS + 300 : 3600;
  return scene.video ? FILM_MS + 300 : 2200;
}

const clamp = (x: number) => Math.min(1, Math.max(0, x));

/**
 * One scene's art. `progress` is the spread's entrance clock, 0 when its page turns in and 1
 * once the entrance has played (and at rest ever after): the plate settles, its cut-outs lift
 * in by depth, the film plays through once and holds, a line scene draws itself before its
 * colour develops. The CSS reads it as --p; the pointer leans the plate by --mx/--my.
 */
export function SceneArt({ scene, progress, active }: { scene: Scene; progress: number; active: boolean }) {
  const p = clamp(progress);
  const style = { ["--p" as string]: p } as CSSProperties;
  const cls = `${s.art} ${s[scene.treatment]} ${active ? s.active : ""} ${p >= 1 ? s.idle : ""}`;

  if (!scene.plate) {
    // No illustration yet: a clean typographic panel, never placeholder clip-art.
    return (
      <div className={`${s.art} ${s.pending} ${active ? s.active : ""}`} style={style} aria-hidden>
        <span className={s.ghostYear}>{scene.year}</span>
        <div className={s.box}>
          <Layers layers={scene.layers.filter((l) => l.overlay)} />
        </div>
      </div>
    );
  }

  if (scene.treatment === "line" && scene.video) {
    // The line film draws its strokes over a faint print, then develops the plate; at rest it holds the plate.
    return (
      <div className={cls} style={style}>
        <div className={s.box}>
          <ScrollVideo
            className={s.film}
            src={scene.video}
            poster={p >= 1 ? scene.plate : scene.poster}
            still={scene.plate}
            progress={p}
            label={scene.visual}
          />
        </div>
      </div>
    );
  }

  if (scene.treatment === "line" && scene.line) {
    // No film yet: one continuous line draws the scene, then its colour develops underneath.
    const draw = clamp(p / 0.62);
    const develop = clamp((p - 0.45) / 0.55);
    return (
      <div className={cls} style={{ ...style, ["--dev" as string]: develop }}>
        <div className={s.box}>
          <img className={s.lineUnder} src={scene.background ?? scene.plate} alt={scene.visual} />
        </div>
        <LineDrawing className={s.lineCanvas} src={scene.line} progress={draw} label={scene.visual} />
      </div>
    );
  }

  if (scene.treatment === "archive") {
    return (
      <div className={cls} style={style}>
        <figure className={s.plateFrame}>
          <div className={s.box}>
            {scene.video ? (
              <ScrollVideo className={`${s.plate} ${s.film}`} src={scene.video} poster={scene.poster} progress={p} label={scene.visual} />
            ) : (
              <img className={s.plate} src={scene.plate} alt={scene.visual} />
            )}
            <Layers layers={scene.layers.filter((l) => l.overlay)} />
          </div>
        </figure>
      </div>
    );
  }

  if (scene.video) {
    // A rendered film of the plate and its cut-outs (pnpm video): it plays through once, then holds.
    return (
      <div className={cls} style={style}>
        <div className={s.box}>
          <ScrollVideo className={s.film} src={scene.video} poster={scene.poster} progress={clamp(p * 1.08)} label={scene.visual} />
          <Layers layers={scene.layers.filter((l) => l.overlay)} />
        </div>
      </div>
    );
  }

  return (
    <div className={cls} style={style}>
      <div className={s.box}>
        <img className={s.background} src={scene.background ?? scene.plate} alt={scene.visual} />
        <Layers layers={scene.layers} />
      </div>
    </div>
  );
}
