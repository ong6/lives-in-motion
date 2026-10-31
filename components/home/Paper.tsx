import type { CSSProperties } from "react";
import s from "./Paper.module.css";

/** The torn top edge of a sheet, in the sheet's stock (`--stock`, `--laid`); `alt` takes the other tear. */
export function Deckle({ alt = false, shift = 0 }: { alt?: boolean; shift?: number }) {
  return <div className={`${s.deckle} ${alt ? s.alt : ""}`} style={shift ? ({ "--tear-x": `${-shift}px` } as CSSProperties) : undefined} aria-hidden />;
}

/** A rule with a hedera at its centre, the printer's leaf. */
export function Fleuron({ className = "" }: { className?: string }) {
  return (
    <div className={`${s.fleuron} ${className}`} aria-hidden>
      <svg viewBox="0 0 26 18">
        <path d="M9 3.2C6.2.4 1.6 1.8 1.7 5.6c.1 3.1 3.6 5.4 7.3 8.6 3.7-3.2 7.2-5.5 7.3-8.6.1-3.8-4.5-5.2-7.3-2.4Z" />
        <path d="M15.6 10.6c2.6 1.7 5.6 2.1 7.6.6 1.4-1.1 1.4-3 .2-3.6-1-.5-2 .3-1.6 1.2" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    </div>
  );
}
