"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { Layer, Scene } from "@/lib/schema";
import { Overlay } from "./Overlay";
import { LineDrawing } from "./LineDrawing";
import { ScrollVideo } from "./ScrollVideo";
import s from "./SceneArt.module.css";

const place = (l: Layer): CSSProperties => ({
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

/** Space between two sheets of the exploded stack, in the plate's own pixels. */
const GAP = 230;

/**
 * The plate taken apart: it tilts back and separates into the sheets it is really made of,
 * bottom to top: Muse Image's clean plate, each SAM 3.1 cut-out at its depth, anything drawn
 * in code, and for a line scene the line drawing. Each sheet carries a label that faces the
 * reader. Closing it lays the sheets back down into the picture.
 */
export function LayerStack({ scene, open }: { scene: Scene; open: boolean }) {
  const [mounted, setMounted] = useState(open);
  const [apart, setApart] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      let r = requestAnimationFrame(() => (r = requestAnimationFrame(() => setApart(true))));
      return () => cancelAnimationFrame(r);
    }
    setApart(false);
    const t = setTimeout(() => setMounted(false), 1300);
    return () => clearTimeout(t);
  }, [open]);
  if (!mounted || !scene.plate) return null;

  const cuts = scene.layers.filter((l) => l.src).sort((a, b) => a.depth - b.depth);
  const drawn = scene.layers.filter((l) => l.overlay);
  type Sheet = { key: string; name: string; by: string; body: React.ReactNode; plane?: boolean };
  const sheets: Sheet[] = [
    {
      key: "bg",
      name: scene.background ? "Clean plate" : "Plate",
      by: "Muse Image",
      body: <img className={s.sheetFill} src={scene.background ?? scene.plate} alt="" />,
    },
    ...cuts.map((l) => ({
      key: l.id,
      name: l.concept,
      by: "Cut out by SAM 3.1",
      plane: true,
      body: (
        <div className={s.sheetLayer} style={place(l)}>
          <img src={l.src} alt="" />
        </div>
      ),
    })),
    ...drawn.map((l) => ({
      key: l.id,
      name: l.concept,
      by: "Drawn in code",
      plane: true,
      body: (
        <div className={s.sheetLayer} style={place(l)}>
          <Overlay kind={l.overlay!} text={l.text} />
        </div>
      ),
    })),
    ...(scene.treatment === "line" && scene.line
      ? [
          {
            key: "line",
            name: "Line drawing",
            by: "Traced from the plate",
            plane: true,
            body: <LineDrawing className={s.sheetLine} src={scene.line} progress={1} label="" />,
          },
        ]
      : []),
  ];
  const mid = (sheets.length - 1) / 2;

  return (
    <div className={`${s.stackView} ${apart ? s.apart : ""}`} aria-hidden={!open}>
      <div className={s.stack}>
        {sheets.map((sh, i) => (
          <div
            key={sh.key}
            className={`${s.sheet} ${sh.plane ? s.plane : ""}`}
            style={{ ["--z" as string]: `${((i - mid) * GAP).toFixed(0)}px`, ["--i" as string]: i } as CSSProperties}
          >
            {sh.body}
            <p className={s.sheetLabel}>
              <i>{sh.name}</i>
              <span>{sh.by}</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
