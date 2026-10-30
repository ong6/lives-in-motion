import { ViewTransition, type CSSProperties, type ReactNode } from "react";
import b from "./book.module.css";

/**
 * The front board of one life: cloth, a blind-stamped double frame and the title in gilt.
 * It sizes its type from its own box, so the same cover sits on the shelf and opens on the
 * story page; both carry the view-transition name `cover-<slug>`, so following a shelf link
 * lifts this cover into the closed book on the next page. The `data-cover` hooks let the shelf
 * lay the same cover out on its own grid.
 */
export function Cover({
  slug,
  name,
  lifespan,
  part,
  className = "",
  style,
  lift = true,
  children,
}: {
  slug: string;
  name: string;
  lifespan: string;
  /** An optional line at the foot of the board (the story books leave it off). */
  part?: string;
  className?: string;
  style?: CSSProperties;
  /** Take part in the shelf-to-book transition; off while the book is open, so leaving mid-book just cross-fades. */
  lift?: boolean;
  children?: ReactNode;
}) {
  const [first, ...more] = name.trim().split(/\s+/);
  const rest = more.join(" ");
  const cover = (
    <div className={`${b.cover} ${className}`} style={style}>
      <div className={b.coverInner} data-cover="inner">
        <p className={b.coverSeries} data-cover="series">
          Lives in Motion
        </p>
        <div className={b.coverTitle} data-cover="title">
          <h2 data-cover="name">
            {/* First word, then the rest: a shelf can set every name on the same two lines. */}
            <span>{first}</span> {rest && <span>{rest}</span>}
          </h2>
          <p data-cover="dates">{lifespan}</p>
        </div>
        {part && (
          <p className={b.coverSeries} data-cover="part">
            {part}
          </p>
        )}
      </div>
      {children}
    </div>
  );
  return lift ? (
    <ViewTransition name={`cover-${slug}`} share="lift" default="none">
      {cover}
    </ViewTransition>
  ) : (
    cover
  );
}

/**
 * The cloth a life is bound in: one of its first era's two inks, darkened with that era's ink.
 * Neighbouring volumes alternate between the two, so the series reads as a set on the shelf.
 */
export const clothFor = (era: { accent: string; accent2: string; ink: string }, part: number) =>
  `color-mix(in oklab, ${part % 2 ? era.accent2 : era.accent} 50%, ${era.ink})`;
