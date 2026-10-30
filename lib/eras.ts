/**
 * Era presets. A scene takes its colours, motion weight and print technique from its year;
 * the same tokens drive the page's CSS variables and the Muse Image prompt, so the art and
 * the interface change decade together. Type stays the same throughout.
 */
export interface Era {
  id: string;
  label: string;
  from: number;
  to: number;
  paper: string;
  ink: string;
  accent: string;
  accent2: string;
  /** Muted ink for secondary text; checked for contrast against paper in tests. */
  muted: string;
  ease: string;
  print: string;
}

export const ERAS: Era[] = [
  {
    id: "colonial",
    label: "Colonial port",
    from: 1819,
    to: 1941,
    paper: "#efe3c8",
    ink: "#2b2118",
    accent: "#9a3c1c",
    accent2: "#4f6b5a",
    muted: "#5e4c3c",
    ease: "power2.out",
    print: "hand-coloured copperplate engraving with fine cross-hatching, sepia and two muted washes",
  },
  {
    id: "occupation",
    label: "Occupation",
    from: 1942,
    to: 1945,
    paper: "#d8d2c3",
    ink: "#1c1b19",
    accent: "#a1281d",
    accent2: "#55554b",
    muted: "#4a473f",
    ease: "power3.inOut",
    print: "wartime woodcut print, heavy black ink, a single blood-red spot colour, rough newsprint texture",
  },
  {
    id: "merdeka",
    label: "Road to merdeka",
    from: 1946,
    to: 1964,
    paper: "#f1e5cd",
    ink: "#22303b",
    accent: "#c4502f",
    accent2: "#2e7b83",
    muted: "#4c5a63",
    ease: "power2.out",
    print: "1950s offset lithograph poster, flat inks with slight misregistration, warm paper",
  },
  {
    id: "nation-building",
    label: "Nation building",
    from: 1965,
    to: 1989,
    paper: "#f3e9d4",
    ink: "#1f2a44",
    accent: "#d23f2a",
    accent2: "#e9a92c",
    muted: "#47506a",
    ease: "back.out(1.4)",
    print: "1970s silkscreen public-campaign poster, bold flat shapes, two-tone halftone shading",
  },
  {
    id: "global-city",
    label: "Global city",
    from: 1990,
    to: 2009,
    paper: "#e9eeec",
    ink: "#13232e",
    accent: "#e0532a",
    accent2: "#139d9a",
    muted: "#3f525d",
    ease: "power3.out",
    print: "1990s risograph print in fluorescent orange and teal, visible grain and slight overprint",
  },
  {
    id: "now",
    label: "Now",
    from: 2010,
    to: 2100,
    paper: "#f5f3ee",
    ink: "#141414",
    accent: "#ff4f2e",
    accent2: "#3355ff",
    muted: "#4d4d4d",
    ease: "expo.out",
    print: "contemporary editorial illustration, cut-paper collage with crisp edges and soft shadows, limited palette",
  },
];

export function eraFor(year: number | string): Era {
  const y = Number(year);
  return ERAS.find((e) => y >= e.from && y <= e.to) ?? ERAS[ERAS.length - 1];
}

export function eraVars(era: Era): Record<string, string> {
  return {
    "--paper": era.paper,
    "--ink": era.ink,
    "--accent": era.accent,
    "--accent2": era.accent2,
    "--muted": era.muted,
  };
}
