"use client";

import { useLayoutEffect, useState } from "react";

/**
 * A one-shot clock for a spread's entrance: 0 → 1 over `duration` ms, starting at `start`
 * (a `performance.now()` time, which may be in the past when a page takes over a sequence
 * already under way). While `start` is null the timeline rests at 1, the finished state, so
 * a page glimpsed under a lifting leaf always looks complete.
 */
export function useTimeline(start: number | null, duration: number): number {
  const [t, setT] = useState(1);
  useLayoutEffect(() => {
    if (start == null || duration <= 0) {
      setT(1);
      return;
    }
    let raf = 0;
    const tick = () => {
      const v = Math.min(1, Math.max(0, (performance.now() - start) / duration));
      setT(v);
      if (v < 1) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [start, duration]);
  return t;
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
