import type { CSSProperties, ReactNode } from "react";
import b from "./book.module.css";

export type Side = "verso" | "recto";

/**
 * One page: paper, a deckled fore-edge, the gutter's shadow, and optional running head and
 * folio. `placed` lays a recto on the right of the open book, under the turning leaves (which
 * position their own faces).
 */
export function Page({
  side,
  head,
  folio,
  placed = false,
  className = "",
  style,
  children,
}: {
  side: Side;
  head?: ReactNode;
  folio?: ReactNode;
  placed?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const pos = placed ? b.atRight : "";
  return (
    <div className={`${b.page} ${b[side]} ${pos} ${className}`} style={style}>
      {head && <p className={b.head}>{head}</p>}
      {children}
      {folio != null && <p className={b.folio}>{folio}</p>}
    </div>
  );
}

/** The life's years, printed small and repeated, as a decorative endpaper. */
export function Endpaper({ years }: { years: string[] }) {
  const line = Array<string>(4).fill(years.join("\u2003")).join("\u2003");
  return (
    <div className={b.endpaper} aria-hidden>
      <div className={b.endpaperPattern}>
        {Array.from({ length: 40 }, (_, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
    </div>
  );
}

export { b as bookStyles };
