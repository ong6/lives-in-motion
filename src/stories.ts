import { Story, type Story as StoryT } from "./schema";

const raw = import.meta.glob("../stories/*/story.json", { eager: true, import: "default" });

/** Every story in /stories, validated; order follows ORDER, then the rest alphabetically. */
const ORDER = ["jack-sim", "lee-kuan-yew", "joseph-schooling"];

export const STORIES: StoryT[] = Object.values(raw)
  .map((s) => Story.parse(s))
  .sort((a, b) => {
    const ia = ORDER.indexOf(a.slug), ib = ORDER.indexOf(b.slug);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.slug.localeCompare(b.slug);
  });

export const bySlug = (slug: string | null) => STORIES.find((s) => s.slug === slug) ?? STORIES[0];
