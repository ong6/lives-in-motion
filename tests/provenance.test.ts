import { describe, expect, it } from "vitest";
import { getStory } from "@/lib/stories";
import { isFamilyBook } from "@/lib/provenance";

describe("a book's provenance", () => {
  it("tells a family book (its notes cite its recording) from a researched one", () => {
    expect(isFamilyBook(getStory("ah-ma-sample")!)).toBe(true);
    for (const slug of ["jack-sim", "joseph-schooling", "tan-howe-liang", "lee-kuan-yew"]) expect(isFamilyBook(getStory(slug)!)).toBe(false);
  });
});
