/**
 * The gallery is paginated as one anthology. Each life takes a frontispiece and title page,
 * one spread per scene (text on the verso, plate on the recto) and a spread of notes, so
 * the folios on a story page agree with the page numbers in the home page's contents.
 */
export const pagesFor = (scenes: number) => 2 * scenes + 4;

/** Page number of each life's frontispiece (always a verso, so even). */
export function firstPages(sceneCounts: number[]): number[] {
  let at = 2;
  return sceneCounts.map((n) => {
    const p = at;
    at += pagesFor(n);
    return p;
  });
}

const NUMERALS: [number, string][] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

export function roman(n: number): string {
  let out = "";
  for (const [v, s] of NUMERALS) while (n >= v) (out += s), (n -= v);
  return out;
}

export const PART = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
