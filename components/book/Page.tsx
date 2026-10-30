import type { CSSProperties, ReactNode } from "react";
import b from "./book.module.css";

export type Side = "verso" | "recto";

/**
 * One page: paper, a deckled fore-edge, the gutter's shadow, and optional running head and
 * folio. `placed` puts it on its side of an open book; leaves position their own faces.
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
  const pos = placed ? (side === "verso" ? b.atLeft : b.atRight) : "";
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

/**
 * A still, open book: boards, page block and two pages. `read` (0–1) sets how much of the
 * page block lies on the left, so a spread near the end of the book looks it.
 */
export function Spread({
  verso,
  recto,
  read = 0.5,
  id,
  className = "",
  style,
}: {
  verso: ReactNode;
  recto: ReactNode;
  read?: number;
  id?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const vars = { ["--bl" as string]: `${3 + 9 * read}px`, ["--br" as string]: `${3 + 9 * (1 - read)}px`, ...style } as CSSProperties;
  return (
    <div id={id} className={`${b.book} ${className}`} style={vars}>
      <div className={`${b.board} ${b.boardL}`} />
      <div className={`${b.board} ${b.boardR}`} />
      <div className={`${b.block} ${b.blockL}`} />
      <div className={`${b.block} ${b.blockR}`} />
      {verso}
      {recto}
    </div>
  );
}

export { b as bookStyles };
