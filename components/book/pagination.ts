import type { Story } from "@/lib/schema";
import { eraFor, type Era } from "@/lib/eras";

/**
 * Each life is its own book with its own folios: the title page is page 1, each chapter is a
 * spread (text on the even verso, plate on the odd recto), then a spread of notes.
 */
export const pagesFor = (scenes: number) => 2 * scenes + 3;

const NUMERALS: [number, string][] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

export function roman(n: number): string {
  let out = "";
  for (const [v, s] of NUMERALS) while (n >= v) (out += s), (n -= v);
  return out;
}

/**
 * The spreads of a book, in order: the closed cover, the endpapers, frontispiece and title page,
 * one spread per scene, the notes, the back endpapers and the closed back cover. Spread k shows
 * the back of leaf k-1 and the front of leaf k.
 */
export type Kind = "cover" | "endpapers" | "title" | "chapter" | "notes" | "endpapersBack" | "closed";

export const TITLE = 2;
export const FIRST_CHAPTER = 3;

export function plan(n: number) {
  const kinds: Kind[] = ["cover", "endpapers", "title", ...Array<Kind>(n).fill("chapter"), "notes", "endpapersBack", "closed"];
  return { kinds, NOTES: FIRST_CHAPTER + n, CLOSED: kinds.length - 1 };
}

/** The era a spread is printed in; the desk takes its colour. */
export function eraAt(story: Story, spread: number): Era {
  const j = spread - FIRST_CHAPTER;
  return eraFor(story.scenes[j >= 0 && j < story.scenes.length ? j : 0].year);
}
