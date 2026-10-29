import { z } from "zod";

/** A citation shown as a chip on the scene it supports. Nothing ships without one. */
export const Source = z.object({
  label: z.string().min(1),
  url: z.string().url(),
});

/**
 * One animatable layer of a scene. Either a generated cut-out (`src`, produced by the
 * illustrate + segment stages) or a built-in SVG motif used before any images exist.
 * `depth` 0 is the back wall, 1 is closest to the reader; motion is derived from it.
 */
export const Layer = z
  .object({
    id: z.string().min(1),
    /** What SAM 3.1 is asked to find, e.g. "toilet". Also the layer's label in x-ray view. */
    concept: z.string().min(1),
    depth: z.number().min(0).max(1),
    src: z.string().optional(),
    motif: z.string().optional(),
    /** Placement on the 16:9 stage: centre x and bottom y in percent, width in percent of stage width. */
    x: z.number().default(50),
    y: z.number().default(90),
    w: z.number().positive().max(140).default(30),
    /** Text for motifs that carry it (banner, calendar, scoreboard). */
    text: z.string().optional(),
    enter: z.enum(["rise", "slide-left", "slide-right", "drop", "fade", "unfold"]).default("rise"),
  })
  .refine((l) => Boolean(l.src || l.motif), { message: "layer needs src or motif" });

export const Scene = z.object({
  id: z.string().regex(/^s\d+$/),
  year: z.string().regex(/^\d{4}$/),
  title: z.string().min(1),
  caption: z
    .string()
    .min(1)
    .refine((c) => c.split(/\s+/).length <= 32, { message: "caption over 32 words: text narrates, it isn't the medium" }),
  /** What the illustration shows. Drives the Muse Image prompt. Figures are silhouettes or seen from behind. */
  visual: z.string().min(1),
  sources: z.array(Source).min(1),
  layers: z.array(Layer).min(1),
});

export const Story = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  born: z.string().regex(/^\d{4}$/),
  died: z.string().nullable(),
  tagline: z.string().min(1),
  /** Default design direction; the reader can switch. */
  direction: z.enum(["paper-theatre", "living-archive", "era-shift"]).default("paper-theatre"),
  generated: z.boolean().default(false),
  scenes: z.array(Scene).min(3).max(10),
});

export type Source = z.infer<typeof Source>;
export type Layer = z.infer<typeof Layer>;
export type Scene = z.infer<typeof Scene>;
export type Story = z.infer<typeof Story>;
export type Direction = Story["direction"];
