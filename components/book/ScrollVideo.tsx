"use client";

import { useEffect, useRef, useState } from "react";

/** How far the shown frame closes on the target per 1/60 s (higher is snappier). */
const FOLLOW = 0.16;
/** Seek only when the target is at least this far from the current frame, in seconds. */
const MIN_SEEK = 1 / 60;

/**
 * A short film scrubbed by a clock: `progress` (0..1) picks the time (the book drives it from
 * each spread's entrance timeline); a rAF loop eases the shown
 * time toward it and seeks only when the difference is worth a frame and the previous seek has
 * landed, so fast flicks never queue seeks. The poster stays underneath until the first frame
 * paints, and is all reduced-motion readers get. `className` positions and sizes the film.
 */
export function ScrollVideo({
  src,
  poster,
  still,
  progress,
  label,
  className,
}: {
  src: string;
  /** The film's first frame, shown while it loads. */
  poster?: string;
  /** What reduced-motion readers see instead of the film; defaults to the poster. */
  still?: string;
  progress: number;
  label?: string;
  className?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const target = useRef(progress);
  const shown = useRef(-1);
  const raf = useRef(0);
  const [ready, setReady] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReducedMotion(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const kick = useRef(() => {});
  useEffect(() => {
    let last = 0;
    const tick = (now: number) => {
      raf.current = 0;
      const v = video.current;
      if (!v || !(v.duration > 0)) return;
      const goal = Math.min(1, Math.max(0, target.current)) * Math.max(0, v.duration - 0.05);
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
      last = now;
      // A jump of more than half the film (a spread replaying its entrance) cuts rather than rewinds.
      if (shown.current < 0 || Math.abs(goal - shown.current) > v.duration / 2) shown.current = goal;
      else shown.current += (goal - shown.current) * (1 - (1 - FOLLOW) ** (dt * 60));
      if (Math.abs(goal - shown.current) < 0.002) shown.current = goal;
      if (!v.seeking && Math.abs(v.currentTime - shown.current) >= MIN_SEEK) v.currentTime = shown.current;
      // Keep going until the shown frame has caught up and the last seek has landed.
      if (shown.current !== goal || v.seeking || Math.abs(v.currentTime - goal) >= MIN_SEEK) raf.current = requestAnimationFrame(tick);
      else last = 0;
    };
    kick.current = () => {
      if (!raf.current) raf.current = requestAnimationFrame(tick);
    };
    // Media events can fire before hydration attaches handlers; catch up on what was missed.
    if ((video.current?.readyState ?? 0) >= 2) setReady(true);
    kick.current();
    return () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      kick.current = () => {};
    };
  }, [reducedMotion]);

  useEffect(() => {
    target.current = progress;
    kick.current();
  }, [progress]);

  if (reducedMotion) return still || poster ? <img className={className} src={still ?? poster} alt={label ?? ""} /> : null;

  return (
    <div className={className} role={label ? "img" : undefined} aria-label={label} style={{ overflow: "hidden" }}>
      {poster && <img src={poster} alt="" aria-hidden style={fill} />}
      <video
        ref={video}
        src={src}
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        disableRemotePlayback
        tabIndex={-1}
        aria-hidden
        style={{ ...fill, opacity: ready ? 1 : 0, transition: "opacity 0.3s ease" }}
        onLoadedMetadata={() => kick.current()}
        onLoadedData={() => {
          setReady(true);
          kick.current();
        }}
        onSeeked={() => kick.current()}
      />
    </div>
  );
}

const fill = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" } as const;
