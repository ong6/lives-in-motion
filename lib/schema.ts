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

/** How a scene's art is presented; the page around it stays the same. */
export const TREATMENTS = ["theatre", "archive", "line"] as const;

export const Scene = z.object({
  id: z.string().regex(/^s\d+$/),
  treatment: z.enum(TREATMENTS).default("theatre"),
  year: z.string().regex(/^\d{4}$/),
  title: z.string().min(1),
  caption: z
    .string()
    .min(1)
    .refine((c) => c.split(/\s+/).length <= 32, { message: "caption over 32 words" }),
  /** Art direction for Muse Image. People only as silhouettes or from behind. */
  visual: z.string().min(1),
  /** Objects SAM 3.1 cuts out of the plate so they can move on their own. */
  cut: z.array(z.string().min(1)).max(3).default([]),
  sources: z.array(Source).min(1),
  /** Muse Image plate as generated, and the same plate with the cut objects removed. */
  plate: z.string().optional(),
  background: z.string().optional(),
  /** Fourier line traced from the plate, for the line treatment. */
  line: z.string().optional(),
  layers: z.array(Layer).default([]),
});

export const Story = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  born: z.string().regex(/^\d{4}$/),
  died: z.string().nullable(),
  tagline: z.string().min(1),
  scenes: z.array(Scene).min(3).max(10),
});

export type Source = z.infer<typeof Source>;
export type Layer = z.infer<typeof Layer>;
export type Scene = z.infer<typeof Scene>;
export type Story = z.infer<typeof Story>;
export type Overlay = (typeof OVERLAYS)[number];
export type Treatment = (typeof TREATMENTS)[number];
