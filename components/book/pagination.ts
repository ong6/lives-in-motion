import type { Story } from "@/lib/schema";
import { eraFor, type Era } from "@/lib/eras";

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
 * one spread per chapter (a deep edition may set a full-spread photograph between two chapters),
 * the notes (two spreads in a deep edition: sources and conflicts, then photographs and how the
 * pictures were made), the back endpapers and the closed back cover. Spread k shows the back of
 * leaf k-1 and the front of leaf k. Each life is its own book with its own folios: the title page
 * is page 1.
 */
export type Kind = "cover" | "endpapers" | "title" | "chapter" | "break" | "notes" | "notes2" | "endpapersBack" | "closed";

export const TITLE = 2;
export const FIRST_CHAPTER = 3;

export interface Plan {
  kinds: Kind[];
  /** Per spread: the chapter it shows (or, for a break, the chapter before it), else -1. */
  scene: number[];
  /** Per spread: the index into story.breaks it shows, else -1. */
  brk: number[];
  /** Chapter j's spread. */
  spreadOf: number[];
  /** The first notes spread, the last (where the next book is reached) and the closed back cover. */
  NOTES: number;
  END: number;
  CLOSED: number;
}

type Planned = Pick<Story, "scenes"> & Partial<Pick<Story, "breaks" | "edition">>;

export function plan(story: Planned): Plan {
  const kinds: Kind[] = ["cover", "endpapers", "title"];
  const scene = [-1, -1, -1];
  const brk = [-1, -1, -1];
  const spreadOf: number[] = [];
  story.scenes.forEach((sc, j) => {
    spreadOf.push(kinds.length);
    kinds.push("chapter");
    scene.push(j);
    brk.push(-1);
    (story.breaks ?? []).forEach((b, i) => {
      if (b.after !== sc.id) return;
      kinds.push("break");
      scene.push(j);
      brk.push(i);
    });
  });
  const NOTES = kinds.length;
  kinds.push("notes");
  if (story.edition === "deep") kinds.push("notes2");
  const END = kinds.length - 1;
  kinds.push("endpapersBack", "closed");
  while (scene.length < kinds.length) scene.push(-1), brk.push(-1);
  return { kinds, scene, brk, spreadOf, NOTES, END, CLOSED: kinds.length - 1 };
}

/** Pages in a book of `scenes` chapters without breaks: the shelf sizes a spine by it. */
export const pagesFor = (scenes: number) => 2 * scenes + 3;

/** Folios: the title page is 1, so spread s has the verso 2(s - TITLE) and the recto one more. */
export const versoFolio = (spread: number) => 2 * (spread - TITLE);
export const rectoFolio = (spread: number) => 2 * (spread - TITLE) + 1;
/** Pages in a book: up to the last notes page. */
export const pagesOf = (p: Plan) => rectoFolio(p.END);

/** The era a spread is printed in; the desk takes its colour. */
export function eraAt(story: Story, spread: number, p: Plan = plan(story)): Era {
  const j = p.scene[spread] ?? -1;
  return eraFor(story.scenes[j >= 0 ? j : 0].year);
}
