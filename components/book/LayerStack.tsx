"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Scene } from "@/lib/schema";
import { LineDrawing } from "../shared/LineDrawing";
import { Overlay } from "./Overlay";
import { place } from "./SceneArt";
import s from "./SceneArt.module.css";

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
export function LayerStack({ scene, open, aside }: { scene: Scene; open: boolean; aside?: ReactNode }) {
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
  type Sheet = { key: string; name: string; by: string; body: ReactNode; plane?: boolean };
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
