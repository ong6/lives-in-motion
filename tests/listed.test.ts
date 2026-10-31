import { describe, expect, it } from "vitest";
import { allStories, everyStory, getStory, isListed, readingOrder } from "@/lib/stories";
import { Story } from "@/lib/schema";

describe("listed lives", () => {
  it("keeps unlisted lives off the shelf and out of the reading order", () => {
    const shelf = allStories();
    expect(shelf.every(isListed)).toBe(true);
    expect(shelf.map((s) => s.slug)).not.toContain("ah-ma-sample");
    expect(everyStory().map((s) => s.slug)).toContain("ah-ma-sample");
  });
  it("still opens an unlisted life by its URL, alone after the shelf", () => {
    expect(getStory("ah-ma-sample")?.listed).toBe(false);
    const o = readingOrder("ah-ma-sample")!;
    expect(o.index).toBe(allStories().length);
    expect(o.stories[o.index].slug).toBe("ah-ma-sample");
    expect(readingOrder("jack-sim")!.stories).toEqual(allStories());
    expect(readingOrder("no-such-life")).toBeUndefined();
    expect(getStory("../etc")).toBeUndefined();
  });
  it("treats a missing flag as listed", () => {
    const base = allStories()[0];
    expect(isListed(Story.parse({ ...base, listed: undefined }))).toBe(true);
    expect(isListed(Story.parse({ ...base, listed: false }))).toBe(false);
  });
});
