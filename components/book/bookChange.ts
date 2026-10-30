/**
 * The book change, as a function of its clock: after the notes of every life but the last,
 * turning on closes this book (the rest of the pages and the back board swing over together),
 * pushes it off to the left, slides the next life's book in from the right and opens it at its
 * title spread. Only then does the route change (StoryPlayer). Pure.
 */
import { easeInOut } from "./useTimeline";
import { seg } from "./paging";

/** The change, in ms from its start. */
export const SEQ = { close: 760, outStart: 640, outEnd: 1380, inStart: 1080, inEnd: 1860, openStart: 1880, end: 2860 };
/** When the next book's title spread starts its entrance, after its cover begins to open. */
export const TITLE_ENTRANCE = SEQ.openStart + 650;

/** Everything the page draws at `t` ms into the change. */
export function bookChangeAt(t: number) {
  // The outgoing book is pushed off to the left; the next slides in from the right and settles.
  const out = seg(t, SEQ.outStart, SEQ.outEnd) ** 2;
  const inn = 1 - (1 - seg(t, SEQ.inStart, SEQ.inEnd)) ** 3;
  return {
    /** The rest of the pages and the back board swinging over (0 → 1). */
    closing: easeInOut(seg(t, 0, SEQ.close)),
    /** The desk retints to the next life's first era just before the book is closed. */
    nextEra: t >= SEQ.close - 120,
    outgoing: `translate(${(-1250 * out).toFixed(1)}px, ${(70 * out).toFixed(1)}px) rotate(${(-7 * out).toFixed(2)}deg) scale(${(1 - 0.08 * out).toFixed(3)})`,
    /** The next book, once it has started to come in. */
    incoming: t >= SEQ.inStart ? `translate(${(1250 * (1 - inn)).toFixed(1)}px, ${(-40 * (1 - inn)).toFixed(1)}px) rotate(${(6 * (1 - inn)).toFixed(2)}deg)` : null,
    /** Where the next book is open to, in spreads: its cover and endpaper leaf turn to the title spread. */
    nextPos: 2 * easeInOut(seg(t, SEQ.openStart, SEQ.end)),
    opening: t >= SEQ.openStart,
  };
}
