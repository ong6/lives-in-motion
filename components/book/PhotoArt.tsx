"use client";

import type { CSSProperties, ReactNode } from "react";
import type { Photo } from "@/lib/schema";
import { LineDrawing } from "../shared/LineDrawing";
import s from "./PhotoArt.module.css";

/**
 * The part of a photo that shows in a box of `boxAspect` (height / width) when it covers the box,
 * kept centred on the subject (`focus`) as far as the frame allows. Fractions of the photo.
 */
export function coverCrop(aspect: number, boxAspect: number, focus: [number, number] = [0.5, 0.45]) {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  if (aspect > boxAspect) {
    // Taller than the box: the full width shows, a band of the height.
    const h = boxAspect / aspect;
    return { x: 0, y: clamp(focus[1] - h / 2, 0, 1 - h), w: 1, h };
  }
  const w = aspect / boxAspect;
  return { x: clamp(focus[0] - w / 2, 0, 1 - w), y: 0, w, h: 1 };
}

/** The crop as CSS object-position, so an <img> with object-fit: cover shows exactly that part. */
export const objectPosition = (c: ReturnType<typeof coverCrop>) =>
  `${c.w < 1 ? ((c.x / (1 - c.w)) * 100).toFixed(2) : 50}% ${c.h < 1 ? ((c.y / (1 - c.h)) * 100).toFixed(2) : 50}%`;

export type Sheet = "photo" | "cutout" | "trace";

/**
 * A photo and what was made from it, in one frame: the photo, SAM 3.1's cut-out of its subject,
 * and the pen trace, all cropped alike. `boxAspect` null shows the whole photo (a mounted print).
 * `show` picks the sheets; `draw` (0–1) is how far the trace has drawn, `develop` how far the photo
 * has come up from a pale wash; `settled` turns the trace from ink to a light overlay.
 */
export function PhotoFrame({
  photo,
  boxAspect,
  show = ["photo", "trace"],
  draw = 1,
  develop = 1,
  settled = true,
  className = "",
  children,
}: {
  photo: Photo;
  boxAspect: number | null;
  show?: Sheet[];
  draw?: number;
  develop?: number;
  settled?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const crop = boxAspect == null ? { x: 0, y: 0, w: 1, h: 1 } : coverCrop(photo.aspect, boxAspect, photo.focus);
  const pos = objectPosition(crop);
  const U = 1000;
  const viewBox = `${(crop.x * U).toFixed(1)} ${(crop.y * photo.aspect * U).toFixed(1)} ${(crop.w * U).toFixed(1)} ${(crop.h * photo.aspect * U).toFixed(1)}`;
  const style = { ["--dev" as string]: develop, ["--obj" as string]: pos } as CSSProperties;
  return (
    <div className={`${s.frame} ${settled ? s.settled : ""} ${className}`} style={style}>
      {show.includes("photo") && <img className={s.photo} src={photo.src} alt={photo.label} draggable={false} />}
      {show.includes("cutout") && photo.cutout && <img className={s.cutout} src={photo.cutout} alt="" draggable={false} />}
      {show.includes("trace") && photo.trace && (
        <LineDrawing className={s.trace} src={photo.trace} progress={draw} label={`${photo.label}, traced in pen`} viewBox={viewBox} />
      )}
      {children}
    </div>
  );
}

/** "Place" and the like, then the label; a person's photo carries only the label. */
export function PhotoLabel({ photo }: { photo: Photo }) {
  return (
    <>
      {photo.tag && <span className={s.tag}>{photo.tag}</span>}
      <span className={s.label}>{photo.label}</span>
    </>
  );
}

/** Artist, licence and source, linked; a pen trace of a share-alike photo is shared alike. */
export function PhotoCredit({ photo, traced = Boolean(photo.trace) }: { photo: Photo; traced?: boolean }) {
  const { artist, license, licenseUrl, page } = photo.credit;
  const sa = /SA/.test(license);
  return (
    <span className={s.credit}>
      Photo: {artist},{" "}
      {licenseUrl ? (
        <a href={licenseUrl} target="_blank" rel="noopener noreferrer">
          {license}
        </a>
      ) : (
        license
      )}
      , via{" "}
      <a href={page} target="_blank" rel="noopener noreferrer">
        {hostOf(page)}
      </a>
      .{traced && sa ? ` Pen trace shared under ${license}.` : ""}
    </span>
  );
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^(www|commons)\./, "").replace(/^wikimedia\.org$/, "Wikimedia Commons");
  } catch {
    return url;
  }
};

export { s as photoStyles };
