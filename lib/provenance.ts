/**
 * Where a book's text came from, read from the story itself. pipeline/family cites every fact
 * to a moment in the book's own recording (`/family/<slug>/audio#t=<s>`); every other book cites
 * web pages found by Muse Spark's search or a hand-curated reading list. Client-safe.
 */
import type { Story } from "./schema";

const RECORDING = /\/family\/[a-z0-9-]+\/audio(?:[#?]|$)/;

/** A family book: its notes cite the recording it was made from. */
export const isFamilyBook = (story: Story) => story.scenes.some((s) => s.sources.some((src) => RECORDING.test(src.url)));
