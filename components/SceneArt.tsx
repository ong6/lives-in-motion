"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
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

/** The exploded stack's pose: scale, tilt back (rotateX) and turn (rotateZ). Labels undo it to face the reader. */
const POSE = { scale: 0.66, tiltX: 56, turnZ: -32 };
/** Total depth the sheets spread over, in the plate's own pixels, and the most between two. */
const SPREAD = 760;
const GAP_MAX = 330;
/** When the first sheet lifts off the plate, and how far apart the next ones follow (ms). */
const LIFT_AT = 650;
const LIFT_EACH = 380;

type Rect = { left: number; top: number; width: number; height: number };

/**
 * The plate taken apart, over the whole open spread: the verso dims, the plate tilts back off
 * the recto across the gutter, and its real sheets lift off one at a time, bottom to top: Muse
 * Image's clean plate, each SAM 3.1 cut-out at its depth, anything drawn in code, and for a line
 * scene the line drawing. Each sheet's label faces the reader from its left corner, over the
 * dimmed verso; `aside` (the director's card) is set on the verso once the sheets are apart.
 * Closing it lays the sheets back down into the picture. Rendered inside the book, which is the
 * positioning box; the plate it starts from is the book's `[data-layers]` element.
 */
export function LayerStack({ scene, open, aside }: { scene: Scene; open: boolean; aside?: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [apart, setApart] = useState(false);
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    setApart(false);
    const t = setTimeout(() => setMounted(false), 1300);
    return () => clearTimeout(t);
  }, [open]);
  // Measure the plate in the book's own (unscaled) pixels, then take it apart on the next frame.
  useLayoutEffect(() => {
    const el = root.current;
    const book = el?.parentElement;
    if (!open || !mounted || !el || !book) return;
    const plate = book.querySelector<HTMLElement>("[data-layers]");
    if (!plate) return;
    const b = book.getBoundingClientRect();
    const r = plate.getBoundingClientRect();
    const k = book.offsetWidth / b.width || 1;
    setRect({ left: (r.left - b.left) * k, top: (r.top - b.top) * k, width: r.width * k, height: r.height * k });
    let raf = requestAnimationFrame(() => (raf = requestAnimationFrame(() => setApart(true))));
    return () => cancelAnimationFrame(raf);
  }, [open, mounted]);
  if (!mounted || !scene.plate) return null;

  const cuts = scene.layers.filter((l) => l.src).sort((a, b) => a.depth - b.depth);
  const drawn = scene.layers.filter((l) => l.overlay);
  type Sheet = { key: string; name: string; by: string; body: React.ReactNode; plane?: boolean };
  const sheets: Sheet[] = [
    {
      key: "bg",
      name: scene.background ? "Clean plate" : "Plate",
      by: scene.background ? "Cleared by Muse Image" : "Painted by Muse Image",
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
  const n = sheets.length;
  const gap = n > 1 ? Math.min(GAP_MAX, SPREAD / (n - 1)) : 0;
  const vars = {
    ["--S" as string]: POSE.scale,
    ["--A" as string]: `${POSE.tiltX}deg`,
    ["--B" as string]: `${POSE.turnZ}deg`,
    ["--sink" as string]: `${(-(n - 1) * gap) / 2}px`,
    ["--done" as string]: `${LIFT_AT + (n - 1) * LIFT_EACH}ms`,
  } as CSSProperties;

  return (
    <div ref={root} className={`${s.stackView} ${apart ? s.apart : ""}`} style={vars} aria-hidden={!open}>
      <div className={s.veil} />
      {rect && (
        <div className={s.stackBox} style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
          <div className={s.stack}>
            {sheets.map((sh, i) => (
              <div
                key={sh.key}
                className={`${s.sheet} ${sh.plane ? s.plane : ""}`}
                style={{ ["--z" as string]: `${(i * gap).toFixed(0)}px`, ["--at" as string]: `${i === 0 ? 0 : LIFT_AT + (i - 1) * LIFT_EACH}ms` } as CSSProperties}
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
      )}
      {aside && <div className={s.aside}>{aside}</div>}
    </div>
  );
}
