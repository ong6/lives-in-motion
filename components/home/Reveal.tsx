"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Turns on the home page's scroll reveals. Without it (no JavaScript) everything is simply shown.
 * It marks the root `data-motion`, so CSS may hold `[data-reveal]` elements back, then sets
 * `data-in` on each one the first time it comes into view. Each element reveals once; nothing
 * is observed after that, and readers who prefer reduced motion get the final state at once.
 */
export function Reveal({ className, children }: { className?: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const targets = [...el.querySelectorAll<HTMLElement>("[data-reveal]")];
    // Anything already on screen at load is shown as is; only what scrolls in is held back.
    const below = targets.filter((t) => t.getBoundingClientRect().top > innerHeight * 0.92);
    for (const t of below) t.dataset.wait = "";
    el.dataset.motion = "on";
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const t = e.target as HTMLElement;
          t.dataset.in = "";
          io.unobserve(t);
        }
      },
      { rootMargin: "0px 0px -14% 0px", threshold: 0.01 },
    );
    for (const t of below) io.observe(t);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={root} className={className}>
      {children}
    </div>
  );
}
