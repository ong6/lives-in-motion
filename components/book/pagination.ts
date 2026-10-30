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

/** @deprecated The lives are separate books, not Parts of one anthology; kept only for older callers. */
export const PART = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
