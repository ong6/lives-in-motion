"use client";

import { useEffect, type RefObject } from "react";
import { COMMIT_PX, GESTURE_GAP, PEEK, clamp, wheel } from "./paging";

export interface PageInput {
  forward: () => void;
  backward: () => void;
  goTo: (spread: number) => void;
  /** Animate the book's position (StoryPlayer's `run`). */
  run: (to: number, ms: number, ease: (t: number) => number) => void;
  /** Set the position at once (a peek). */
  setPos: (pos: number) => void;
  toggleLayers: (open?: boolean) => void;
  lastSpread: number;
  /** Turning past the last spread changes books. */
  hasNext: boolean;
  /** The spread at rest. */
  settled: RefObject<number>;
  /** A turn is under way, or the book change. */
  busy: RefObject<boolean>;
  changing: () => boolean;
  /** The plate a spread shows, so L only takes apart a spread that has one. */
  hasPlate: (spread: number) => boolean;
  anim: RefObject<number>;
  stage: RefObject<HTMLDivElement | null>;
}

/**
 * One gesture, one leaf: the wheel or trackpad (a peek under COMMIT_PX, a turn past it, the rest
 * of the gesture swallowed), the keys, a swipe, and the pointer leaning the plates a few pixels.
 */
export function usePageInput(o: PageInput) {
  const { forward, backward, goTo, run, setPos, toggleLayers, lastSpread, hasNext, settled, busy, changing, hasPlate, anim, stage } = o;
  useEffect(() => {
    let acc = 0;
    let release = 0;

    const peek = (v: number) => {
      if (busy.current || changing()) return;
      const base = settled.current;
      const room = v > 0 ? (base < lastSpread || hasNext ? 1 : 0.25) : base > 0 ? 1 : 0.25;
      cancelAnimationFrame(anim.current);
      setPos(base + clamp(v, -1, 1) * PEEK * room);
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch zoom
      e.preventDefault();
      const scale = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
      const d = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * scale;
      const now = performance.now();
      const gap = now - wheel.last;
      const mag = Math.abs(d);
      wheel.last = now;
      // A gesture is over after a pause, or when the deltas jump up again (a new flick inside the inertia).
      // Or, once the page has landed, by a strong push that is not dying away: a mouse wheel's next
      // notches, not a trackpad's inertia (which by then is a few px and still falling).
      const restart = wheel.spent && !busy.current && !changing() && now - wheel.landed > 200 && mag >= 24 && mag >= wheel.lastMag * 0.95;
      const fresh = gap > GESTURE_GAP || (wheel.spent && mag > wheel.lastMag * 2.2 && mag > 24) || restart;
      wheel.lastMag = mag;
      if (fresh) {
        wheel.spent = false;
        acc = 0;
      }
      // Just arrived from a book change: the title spread holds until the input has been quiet a moment.
      // During the change itself all input is dropped; it plays through to the next book's title spread.
      if (now < wheel.quietUntil || changing() || wheel.spent || busy.current) {
        wheel.spent = true;
        return;
      }
      if (acc !== 0 && Math.sign(d) !== Math.sign(acc)) acc = 0;
      acc += d;
      clearTimeout(release);
      if (Math.abs(acc) >= COMMIT_PX) {
        wheel.spent = true;
        acc = 0;
        if (d > 0) forward();
        else backward();
        return;
      }
      peek(acc / COMMIT_PX);
      release = window.setTimeout(() => {
        acc = 0;
        if (!busy.current && !changing()) run(settled.current, 240, (t) => 1 - (1 - t) ** 3);
      }, GESTURE_GAP);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable]")) return;
      const onControl = el?.closest("button, a");
      if (e.key === "Escape") return toggleLayers(false);
      if ((e.key === "l" || e.key === "L") && !changing() && !busy.current) {
        if (hasPlate(settled.current)) toggleLayers();
        return;
      }
      const fwd = ["ArrowRight", "ArrowDown", "PageDown"].includes(e.key) || (e.key === " " && !e.shiftKey && !onControl);
      const back = ["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key) || (e.key === " " && e.shiftKey && !onControl);
      if (fwd || back || e.key === "Home" || e.key === "End") e.preventDefault();
      else return;
      if (changing() || busy.current) return;
      if (fwd) forward();
      else if (back) backward();
      else goTo(e.key === "Home" ? 0 : lastSpread);
    };

    let touch: { x: number; y: number } | null = null;
    const onTouchStart = (e: TouchEvent) => (touch = { x: e.touches[0].clientX, y: e.touches[0].clientY });
    const onTouchMove = (e: TouchEvent) => e.preventDefault();
    const onTouchEnd = (e: TouchEvent) => {
      if (!touch) return;
      const dx = e.changedTouches[0].clientX - touch.x;
      const dy = e.changedTouches[0].clientY - touch.y;
      touch = null;
      const d = Math.abs(dx) > Math.abs(dy) ? -dx : -dy;
      if (Math.abs(d) < 40) return;
      if (d > 0) forward();
      else backward();
    };

    // The pointer leans the plates a few pixels, deeper layers more.
    let praf = 0;
    let px = 0;
    let py = 0;
    const onPointer = (e: PointerEvent) => {
      px = (e.clientX / innerWidth) * 2 - 1;
      py = (e.clientY / innerHeight) * 2 - 1;
      praf ||= requestAnimationFrame(() => {
        praf = 0;
        stage.current?.style.setProperty("--mx", px.toFixed(3));
        stage.current?.style.setProperty("--my", py.toFixed(3));
      });
    };

    addEventListener("wheel", onWheel, { passive: false });
    addEventListener("keydown", onKey);
    addEventListener("touchstart", onTouchStart, { passive: true });
    addEventListener("touchmove", onTouchMove, { passive: false });
    addEventListener("touchend", onTouchEnd);
    addEventListener("pointermove", onPointer, { passive: true });
    return () => {
      removeEventListener("wheel", onWheel);
      removeEventListener("keydown", onKey);
      removeEventListener("touchstart", onTouchStart);
      removeEventListener("touchmove", onTouchMove);
      removeEventListener("touchend", onTouchEnd);
      removeEventListener("pointermove", onPointer);
      clearTimeout(release);
      cancelAnimationFrame(praf);
    };
    // The handlers read the refs live; they are rebound only when what they call changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forward, backward, goTo, run, lastSpread, hasNext, hasPlate]);
}
