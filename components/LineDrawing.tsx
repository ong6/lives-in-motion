"use client";

import { useEffect, useRef, useState } from "react";
import { evaluate, type Term } from "@/lib/fourier";
import { inGap } from "@/lib/draw";

export interface LineData {
  terms: Term[];
  gaps: [number, number][];
  aspect: number;
}

const STEPS = 3200;
/** Epicycles drawn on screen; the rest still move the pen but are too small to see. */
const SHOWN = 90;

/**
 * A single line drawing itself with Fourier epicycles on a canvas. `progress` (0–1) comes
 * from the scroll position; without it the drawing loops on its own. Colours follow CSS
 * `color` so the line takes on each era's ink.
 */
export function LineDrawing({
  src,
  progress,
  loop = false,
  circles = true,
  label,
  className,
}: {
  src: string;
  progress?: number;
  loop?: boolean;
  circles?: boolean;
  label: string;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<LineData | null>(null);
  const samples = useRef<{ x: number; y: number; gap: boolean }[]>([]);
  const progressRef = useRef(progress ?? 0);
  progressRef.current = progress ?? progressRef.current;

  useEffect(() => {
    let live = true;
    fetch(src)
      .then((r) => r.json())
      .then((d: LineData) => {
        if (!live) return;
        samples.current = Array.from({ length: STEPS + 1 }, (_, i) => {
          const t = i / STEPS;
          const [x, y] = evaluate(d.terms, t).pen;
          return { x, y, gap: inGap(d.gaps, t) };
        });
        setData(d);
      });
    return () => {
      live = false;
    };
  }, [src]);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !data) return;
    const ctx = el.getContext("2d")!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let start = performance.now();

    const frame = (now: number) => {
      const dpr = Math.min(devicePixelRatio, 2);
      const { width, height } = el.getBoundingClientRect();
      if (el.width !== Math.round(width * dpr)) {
        el.width = Math.round(width * dpr);
        el.height = Math.round(height * dpr);
      }
      const size = Math.min(width, height) * dpr;
      const ox = (width * dpr) / 2;
      const oy = (height * dpr) / 2;
      const map = (x: number, y: number) => [ox + x * size, oy + y * size] as const;

      let p: number;
      if (reduced) p = 1;
      else if (loop) {
        // Draw for 14 s, hold 3 s, start again.
        const cycle = ((now - start) / 1000) % 17;
        p = Math.min(1, cycle / 14);
      } else p = progressRef.current;

      const ink = getComputedStyle(el).color;
      ctx.clearRect(0, 0, el.width, el.height);
      ctx.lineJoin = ctx.lineCap = "round";
      const end = Math.round(p * STEPS);
      const pts = samples.current;

      // Ink, then pen travel as a faint hairline.
      for (const travel of [false, true]) {
        ctx.beginPath();
        for (let i = 1; i <= end; i++) {
          if (pts[i].gap !== travel) continue;
          const [ax, ay] = map(pts[i - 1].x, pts[i - 1].y);
          const [bx, by] = map(pts[i].x, pts[i].y);
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
        }
        ctx.strokeStyle = ink;
        ctx.globalAlpha = travel ? 0.14 : 1;
        ctx.lineWidth = (travel ? 0.6 : 1.3) * dpr;
        ctx.stroke();
      }

      if (circles && p > 0 && p < 1) {
        const { centres, pen } = evaluate(data.terms, p, SHOWN);
        ctx.globalAlpha = 0.22;
        ctx.lineWidth = 0.8 * dpr;
        ctx.beginPath();
        centres.forEach(([cx, cy], i) => {
          const r = data.terms[i].amp * size;
          if (r < 1.5) return;
          const [x, y] = map(cx, cy);
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        });
        ctx.stroke();
        const [px, py] = map(pen[0], pen[1]);
        ctx.globalAlpha = 1;
        ctx.fillStyle = getComputedStyle(el).getPropertyValue("--accent") || ink;
        ctx.beginPath();
        ctx.arc(px, py, 3.2 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    start = performance.now();
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [data, loop, circles]);

  return <canvas ref={canvas} className={className} role="img" aria-label={label} />;
}
