"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A short scene film that plays on a loop while it is on screen. Readers who prefer reduced
 * motion get the poster frame.
 */
export function LoopFilm({
  src,
  poster,
  label,
  className,
  preload = "metadata",
}: {
  src: string;
  poster?: string;
  label: string;
  className?: string;
  preload?: "auto" | "metadata" | "none";
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [still, setStill] = useState(false);

  useEffect(() => setStill(matchMedia("(prefers-reduced-motion: reduce)").matches), []);

  useEffect(() => {
    const v = video.current;
    if (!v || still) return;
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? v.play().catch(() => {}) : v.pause()), { threshold: 0.01 });
    io.observe(v);
    return () => io.disconnect();
  }, [still]);

  if (still) return poster ? <img className={className} src={poster} alt={label} /> : null;
  return <video ref={video} className={className} src={src} poster={poster} muted loop playsInline preload={preload} aria-label={label} />;
}
