import { z } from "zod";

export const Source = z.object({
  label: z.string().min(1),
  url: z.string().url(),
});

/** Things image models get wrong (flags, digits, dates) are drawn exactly in code instead. */
export const OVERLAYS = ["sg-flag", "scoreboard", "calendar"] as const;

/**
 * One moving piece of a scene, placed in the scene's square art box: x is the centre and
 * y the bottom edge, both in percent; w is the width in percent. depth 0 is far, 1 is near.
 * Either a SAM 3.1 cut-out (`src`) or an exact overlay drawn in code.
 */
export const Layer = z
  .object({
    id: z.string().min(1),
    /** Short noun phrase SAM 3.1 looks for ("toilet"); also the x-ray label. */
    concept: z.string().min(1),
    depth: z.number().min(0).max(1),
    x: z.number(),
    y: z.number(),
    w: z.number().positive().max(100),
    src: z.string().optional(),
    overlay: z.enum(OVERLAYS).optional(),
    text: z.string().optional(),
  })
  .refine((l) => Boolean(l.src) !== Boolean(l.overlay), { message: "layer needs exactly one of src or overlay" });

/**
 * ok: Muse Spark found the caption supported. disputed: it found a problem not yet fixed.
 * corrected: it disputed the caption and the caption was rewritten to match the sources.
 */
export const VERDICTS = ["ok", "disputed", "corrected"] as const;
export const Checked = z.object({
  model: z.string().min(1),
  verdict: z.enum(VERDICTS),
  at: z.string().min(1),
  /** Muse Spark's one-line reason, as returned. */
  note: z.string().optional(),
  /** URLs it cited for the verdict. */
  sources: z.array(z.string()).default([]),
});

/** How a scene's art is presented. A photo scene shows a real, openly licensed photograph. */
export const TREATMENTS = ["theatre", "archive", "line", "photo"] as const;

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/** Who took a real photograph and under what licence; shown on its page and in the notes. */
export const PhotoCredit = z.object({
  artist: z.string().min(1),
  license: z.string().min(1),
  licenseUrl: z.string().url().nullable().optional(),
  /** The file's page (Wikimedia Commons, Flickr). */
  page: z.string().url(),
});

/**
 * A real photograph on a deep-edition page, with SAM 3.1's mask of its subject and the pen trace
 * drawn over it. `kind: "place"` photos (a building, an object, an event) carry a visible label so
 * they are never read as the person.
 */
export const Photo = z.object({
  src: z.string().min(1),
  /** height / width */
  aspect: z.number().positive(),
  kind: z.enum(["person", "place"]),
  /** What SAM 3.1 looked for ("person", "toilet"). */
  concept: z.string().min(1),
  /** The page's label for it, with its own year ("World Toilet Day at the UN, 2015"). */
  label: z.string().min(1),
  /** "Place", "Object", "Event": printed on a photo that does not show the person. */
  tag: z.string().optional(),
  year: z.string().min(1),
  /** The subject's centre in the frame (fractions), so a cropped photo keeps it in view. */
  focus: z.tuple([z.number(), z.number()]).optional(),
  /** Small or poor originals are shown as a mounted print rather than full-bleed. */
  mounted: z.boolean().optional(),
  /** SAM 3.1's cut-out of the subject (the photo with the mask as alpha), and the pen trace (a line file). */
  cutout: z.string().optional(),
  trace: z.string().optional(),
  credit: PhotoCredit,
});

/** A quotation used verbatim from the research, with where it was said. */
export const Quote = z.object({
  text: z.string().min(1),
  speaker: z.string().min(1),
  source: Source,
});

export const Scene = z.object({
  id: z.string().regex(/^s\d+$/),
  treatment: z.enum(TREATMENTS).default("theatre"),
  year: z.string().regex(/^\d{4}$/),
  /** The year as printed when it is approximate ("1960s", "mid-1990s"); `year` still places it. */
  when: z.string().optional(),
  title: z.string().min(1),
  caption: z
    .string()
    .min(1)
    .refine((c) => c.split(/\s+/).length <= 32, { message: "caption over 32 words" }),
  /**
   * Deep edition: the chapter told as a story by Muse Spark from the numbered facts. `body` opens
   * on a concrete moment; `voice` is the pull-quote line; `turn` is the teaser at the foot of the
   * page; `age` is the person's age at that moment; `quote` is the one quotation it uses, if any.
   */
  body: z
    .string()
    .refine((b) => words(b) <= 175, { message: "body over 175 words" })
    .optional(),
  voice: z.string().optional(),
  turn: z.string().optional(),
  age: z.number().int().min(0).max(130).optional(),
  quote: Quote.optional(),
  photo: Photo.optional(),
  /** Art direction for Muse Image (or, for a photo scene, what the photo shows). People only as silhouettes or from behind. */
  visual: z.string().min(1),
  /** Objects SAM 3.1 cuts out of the plate so they can move on their own. */
  cut: z.array(z.string().min(1)).max(3).default([]),
  sources: z.array(Source).min(1),
  /** Muse Image plate as generated, and the same plate with the cut objects removed. */
  plate: z.string().optional(),
  background: z.string().optional(),
  /** Pen-plotter line drawing traced from the plate, for the line treatment. */
  line: z.string().optional(),
  /** Short 2.5D film of the scene (pnpm video), played when its page turns open, and its first frame. */
  video: z.string().optional(),
  poster: z.string().optional(),
  layers: z.array(Layer).default([]),
  /** The caption's fact-check by Muse Spark with web search (`pnpm make <slug> --stages verify`). */
  checked: Checked.optional(),
});

export const Story = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  born: z.string().regex(/^\d{4}$/),
  died: z.string().nullable(),
  tagline: z.string().min(1),
  /**
   * On the shelf and in its reading order. Absent means listed; false keeps a life off the shelf
   * (a /create draft awaiting `pnpm approve`, or a life withdrawn) while its URL still opens.
   */
  listed: z.boolean().optional(),
  /** "deep": twelve chapters told as a story, with real photographs among the plates. */
  edition: z.literal("deep").optional(),
  /** Where the sources disagreed, and the reading the book follows (printed in the notes). */
  conflicts: z.array(z.object({ topic: z.string().min(1), choice: z.string().min(1) })).optional(),
  /** Full-spread photographs between chapters, for pacing: shown after the scene `after`. */
  breaks: z.array(z.object({ after: z.string().regex(/^s\d+$/), photo: Photo })).optional(),
  scenes: z.array(Scene).min(3).max(14),
});

export type Source = z.infer<typeof Source>;
export type Checked = z.infer<typeof Checked>;
export type Layer = z.infer<typeof Layer>;
export type Scene = z.infer<typeof Scene>;
export type Story = z.infer<typeof Story>;
export type Photo = z.infer<typeof Photo>;
export type Quote = z.infer<typeof Quote>;
export type Overlay = (typeof OVERLAYS)[number];
