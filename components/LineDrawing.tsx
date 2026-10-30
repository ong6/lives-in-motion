"use client";

import { useEffect, useRef, useState } from "react";

export interface LineData {
  /** height / width */
  aspect: number;
  /** Polylines in plotter order as flat x,y pairs in a box 1 wide and `aspect` tall. */
  strokes: number[][];
}

/** Drawing units: the SVG is 1000 wide so stroke widths and dash lengths stay in whole numbers. */
const U = 1000;

const toPath = (s: number[]) => {
  let d = "";
  for (let i = 0; i < s.length; i += 2) d += `${i ? "L" : "M"}${(s[i] * U).toFixed(1)} ${(s[i + 1] * U).toFixed(1)}`;
  return d;
};

/**
 * A pen-plotter line drawing that draws itself, stroke by stroke, with vivus
 * (https://github.com/maxwellito/vivus, MIT). `progress` (0–1) comes from the scroll
 * position; with `loop` it draws on its own and starts again. The ink follows CSS `color`.
 */
export function LineDrawing({ src, progress, loop = false, label, className }: { src: string; progress?: number; loop?: boolean; label: string; className?: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const vivus = useRef<{ setFrameProgress(p: number): unknown; destroy(): void } | null>(null);
  const progressRef = useRef(progress ?? 1);
  progressRef.current = progress ?? progressRef.current;
  const [data, setData] = useState<LineData | null>(null);

  useEffect(() => {
    let live = true;
    fetch(src)
      .then((r) => r.json())
      .then((d: LineData) => live && setData(d));
    return () => {
      live = false;
    };
  }, [src]);

  useEffect(() => {
    if (!data || !svg.current) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    import("vivus").then(({ default: Vivus }) => {
      if (!live || !svg.current) return;
      const v = new Vivus(svg.current as unknown as HTMLElement, { type: "oneByOne", start: "manual", duration: 420, animTimingFunction: Vivus.EASE_OUT });
      vivus.current = v;
      if (reduced) v.finish();
      else if (loop) {
        // Draw, hold for 3 s, start again.
        const run = () => v.reset().play(1, () => (timer = setTimeout(run, 3000)));
        run();
      } else v.setFrameProgress(progressRef.current);
    });
    return () => {
      live = false;
      clearTimeout(timer);
      vivus.current?.destroy();
      vivus.current = null;
    };
  }, [data, loop]);

  useEffect(() => {
    if (!loop && progress != null) vivus.current?.setFrameProgress(Math.max(0, Math.min(1, progress)));
  }, [progress, loop]);

  return (
    <svg
      // A fresh element per drawing: vivus writes dash styles onto the paths.
      key={src}
      ref={svg}
      className={className}
      viewBox={`0 0 ${U} ${Math.round((data?.aspect ?? 1) * U)}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={label}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {data?.strokes.map((s, i) => <path key={i} d={toPath(s)} />)}
    </svg>
  );
}
