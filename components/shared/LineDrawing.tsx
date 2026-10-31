"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export interface LineData {
  /** height / width */
  aspect: number;
  /** Polylines in plotter order as flat x,y pairs in a box 1 wide and `aspect` tall. */
  strokes: number[][];
  /** The traced photo, cut out and toned; revealed under the lines as the drawing completes. */
  photo?: string;
}

/** Drawing units: the SVG is 1000 wide so stroke widths and dash lengths stay in whole numbers. */
const U = 1000;
/** Photos are cropped at the chest; fade the cut edge into the paper. */
const FADE = "linear-gradient(to bottom, #000 72%, transparent 98%)";

const toPath = (s: number[]) => {
  let d = "";
  for (let i = 0; i < s.length; i += 2) d += `${i ? "L" : "M"}${(s[i] * U).toFixed(1)} ${(s[i + 1] * U).toFixed(1)}`;
  return d;
};

/**
 * A pen-plotter line drawing that draws itself, stroke by stroke, with vivus
 * (https://github.com/maxwellito/vivus, MIT). `progress` (0–1) comes from the
 * spread's entrance clock; with `loop` it draws on its own and starts again. The ink follows CSS `color`.
 * As the last strokes land, the real photo the drawing was traced from develops underneath,
 * so the page ends on the actual person rather than an approximation of them.
 */
export function LineDrawing({
  src,
  progress,
  loop = false,
  label,
  className,
  fallback = null,
}: {
  /** A line file; a life made on /create may not have one yet. */
  src?: string;
  progress?: number;
  loop?: boolean;
  label: string;
  className?: string;
  /** Shown instead when there is no line file or it fails to load. */
  fallback?: ReactNode;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const vivus = useRef<{ setFrameProgress(p: number): unknown; destroy(): void } | null>(null);
  const progressRef = useRef(progress ?? 1);
  progressRef.current = progress ?? progressRef.current;
  const [data, setData] = useState<LineData | null>(null);
  const [missing, setMissing] = useState(!src);
  /** Photo opacity, 0–1. Driven by `progress`, it follows the last 30% of it; in loop mode it fades in after each draw. */
  const [reveal, setReveal] = useState(0);

  useEffect(() => {
    let live = true;
    setMissing(!src);
    if (!src) return;
    fetch(src)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: LineData) => {
        if (!live) return;
        if (Array.isArray(d?.strokes) && d.strokes.length) setData(d);
        else setMissing(true);
      })
      .catch(() => live && setMissing(true));
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
      if (reduced) {
        v.finish();
        setReveal(1);
      } else if (loop) {
        // Draw, let the photo develop, hold, then clear and draw again.
        const run = () => {
          setReveal(0);
          v.reset().play(1, () => {
            setReveal(1);
            timer = setTimeout(run, 6000);
          });
        };
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
    if (loop || progress == null) return;
    const p = Math.max(0, Math.min(1, progress));
    vivus.current?.setFrameProgress(p);
    setReveal(Math.max(0, (p - 0.7) / 0.3));
  }, [progress, loop]);

  const box = { position: "absolute", inset: 0, width: "100%", height: "100%" } as const;
  if (missing) return <>{fallback}</>;
  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
      {data?.photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.photo}
          alt=""
          aria-hidden
          style={{ ...box, objectFit: "contain", mixBlendMode: "multiply", maskImage: FADE, WebkitMaskImage: FADE, opacity: reveal * 0.92, transition: loop ? "opacity 1.6s ease" : undefined }}
        />
      )}
      <svg
        // A fresh element per drawing: vivus writes dash styles onto the paths.
        key={src}
        ref={svg}
        style={{ ...box, opacity: 1 - reveal * 0.55, transition: loop ? "opacity 1.6s ease" : undefined }}
        viewBox={`0 0 ${U} ${Math.round((data?.aspect ?? 1) * U)}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={label}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {data?.strokes.map((s, i) => <path key={i} d={toPath(s)} />)}
      </svg>
    </div>
  );
}
