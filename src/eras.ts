/**
 * Era presets: the design tokens a scene inherits from its year. This is how "the design
 * changes by era" scales: the pipeline picks a preset, it never hand-styles a person.
 * The same tokens feed the CSS (custom properties) and the Muse Image style prompt.
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
  display: string;
  body: string;
  /** CSS easing used for this era's entrances. Older eras move slower and heavier. */
  ease: string;
  duration: number;
  /** Print technique the era's illustrations imitate; goes straight into the image prompt. */
  print: string;
  grain: number;
}

export const ERAS: Era[] = [
  {
    id: "colonial",
    label: "Colonial port",
    from: 1819,
    to: 1941,
    paper: "#efe4cc",
    ink: "#2b2118",
    accent: "#8a3b1f",
    accent2: "#4f6b5a",
    display: "'IM Fell English', serif",
    body: "'Source Serif 4', serif",
    ease: "power2.out",
    duration: 1.4,
    print: "hand-coloured copperplate engraving, cross-hatched shading, sepia ink on rag paper",
    grain: 0.5,
  },
  {
    id: "occupation",
    label: "Occupation",
    from: 1942,
    to: 1945,
    paper: "#d9d3c4",
    ink: "#1d1c1a",
    accent: "#9e2a20",
    accent2: "#5a5a50",
    display: "'Oswald', sans-serif",
    body: "'Source Serif 4', serif",
    ease: "power3.inOut",
    duration: 1.2,
    print: "wartime woodcut, heavy black ink, one blood-red spot colour, rough newsprint",
    grain: 0.7,
  },
  {
    id: "merdeka",
    label: "Road to merdeka",
    from: 1946,
    to: 1964,
    paper: "#f1e6d0",
    ink: "#23303a",
    accent: "#c8553d",
    accent2: "#2f7c84",
    display: "'Playfair Display', serif",
    body: "'Source Serif 4', serif",
    ease: "power2.out",
    duration: 1.1,
    print: "1950s lithograph poster, flat inks with slight misregistration, warm paper",
    grain: 0.45,
  },
  {
    id: "nation-building",
    label: "Nation building",
    from: 1965,
    to: 1989,
    paper: "#f4ecd9",
    ink: "#1f2a44",
    accent: "#d6402b",
    accent2: "#f2b134",
    display: "'Archivo Black', sans-serif",
    body: "'Archivo', sans-serif",
    ease: "back.out(1.4)",
    duration: 0.9,
    print: "1970s silkscreen public-campaign poster, bold flat shapes, two-tone halftone",
    grain: 0.35,
  },
  {
    id: "global-city",
    label: "Global city",
    from: 1990,
    to: 2009,
    paper: "#eef1f0",
    ink: "#13232e",
    accent: "#e4572e",
    accent2: "#17bebb",
    display: "'Space Grotesk', sans-serif",
    body: "'Space Grotesk', sans-serif",
    ease: "power3.out",
    duration: 0.8,
    print: "1990s risograph print, fluorescent orange and teal, visible grain and overprint",
    grain: 0.3,
  },
  {
    id: "now",
    label: "Now",
    from: 2010,
    to: 2100,
    paper: "#f7f5f0",
    ink: "#111111",
    accent: "#ff5a36",
    accent2: "#3a5bff",
    display: "'Instrument Serif', serif",
    body: "'Instrument Sans', sans-serif",
    ease: "expo.out",
    duration: 0.7,
    print: "contemporary cut-paper collage, crisp edges, soft studio shadow, limited palette",
    grain: 0.15,
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
    "--display": era.display,
    "--body": era.body,
    "--grain": String(era.grain),
  };
}

export const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&family=Archivo+Black&family=Archivo:wght@400;600&family=IM+Fell+English:ital@0;1&family=Instrument+Sans:wght@400;600&family=Instrument+Serif:ital@0;1&family=Oswald:wght@500;700&family=Playfair+Display:ital,wght@0,700;1,500&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=Space+Grotesk:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap";
