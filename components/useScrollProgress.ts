"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * 0 when the element's top reaches the viewport top, 1 when its bottom reaches the viewport bottom.
 * `initial` is what the server renders with, for a page that opens part-way down.
 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>, initial = 0): number {
  const [p, setP] = useState(initial);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const { top, height } = el.getBoundingClientRect();
      const span = height - innerHeight;
      setP(span > 0 ? Math.min(1, Math.max(0, -top / span)) : 0);
    };
    const onScroll = () => (raf ||= requestAnimationFrame(update));
    update();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [ref]);
  return p;
}
