/**
 * The editor's hand on the deep edition: what the research agent's storyboards can't decide alone.
 * For each life: how each photograph is labelled and what SAM 3.1 looks for in it, photographs we
 * must not use (and the plate that replaces them), art directions that would put a flag or a face
 * in a plate, notes to Muse Spark where a draft leans on war or politics, the full-spread photo
 * breaks between chapters, and the frontispiece.
 */

export interface PhotoUse {
  /** The page label, with the photo's own year. */
  label: string;
  /** "Place", "Object" or "Event": printed beside a photo that is not the person. */
  tag?: string;
  /** What SAM 3.1 masks: "person", or a concept for an object or a place. */
  concept: string;
  /** For a person: things in front of them that belong in the mask. */
  include?: string[];
  /** Crop of the original, as fractions [left, top, width, height]. */
  crop?: [number, number, number, number];
  mounted?: boolean;
}

export interface LifeConfig {
  /** Photo chapters, by storyboard chapter number. */
  photos: Record<number, PhotoUse>;
  /** Chapters whose photograph we may not use: they become plates with this art direction. */
  replace?: Record<number, { direction: string; cut: string[] }>;
  /** Art directions rewritten (a flag or a face would reach the image model). */
  art?: Record<number, { direction: string; cut?: string[] }>;
  /** Notes to Muse Spark for one chapter. */
  notes?: Record<number, string>;
  /** Full-spread photographs between chapters: after storyboard chapter `after`. */
  breaks?: { after: number; file: string; use: PhotoUse }[];
  /** The frontispiece: traced from this photo (or keep the one already traced: "keep"). */
  frontispiece: "keep" | { file: string; concept: string; depicts?: string };
}

/** Photographs that must never be used (licence or permission unclear). */
export const BANNED = [
  // National Archives of Singapore record: reproduction only with permission.
  "tan-kah-kee-lee-kong-chian-and-tan-lark-sye-1946.png",
  "lee-kong-chian-1946.png",
  // {{PD-Iran}}, author unknown, US status not stated.
  "kenji-onuma-tan-howe-liang-henrik-tamraz-1958.jpg",
];

const NO_WAR = "Keep war and politics out entirely; phrase around them in a few plain words.";

export const LIVES: Record<string, LifeConfig> = {
  "jack-sim": {
    photos: {
      7: { label: "Jack Sim at a World Toilet Organization photo call, 2005", concept: "person", include: ["toilet", "plunger"] },
      9: { label: "World Toilet Day at the United Nations, New York, 2015", tag: "Place", concept: "inflatable toilet" },
      11: { label: "Jack Sim as Rodin's Thinker, 2015", concept: "person", include: ["toilet"] },
    },
    breaks: [{ after: 8, file: "session-4-jack-sim-wto-singapore-5961634214.jpg", use: { label: "Jack Sim speaking at a sanitation meeting in Kigali, Rwanda, 2011", concept: "person" } }],
    frontispiece: "keep",
  },
  "joseph-schooling": {
    photos: {
      7: { label: "Joseph Schooling at the World Championships, Kazan, 2015", concept: "person" },
      8: { label: "The Olympic Aquatics Stadium, Rio, on finals night, 12 August 2016", tag: "Place", concept: "swimming pool" },
    },
    breaks: [{ after: 7, file: "est-dio-aqu-tico-ol-mpico-interno-1.jpg", use: { label: "The Olympic Aquatics Stadium, Rio, empty, August 2016", tag: "Place", concept: "swimming pool" } }],
    frontispiece: "keep",
  },
  "tan-howe-liang": {
    photos: {
      7: { label: "The Palazzetto dello Sport, Rome, photographed in 1963", tag: "Place", concept: "dome" },
      10: { label: "The old National Stadium, Kallang, 2007", tag: "Place", concept: "stadium", mounted: true },
      12: { label: "Tan Howe Liang welcoming Singapore's Olympians home, 2008", concept: "person", crop: [0, 0.18, 0.36, 0.82] },
    },
    replace: {
      5: {
        direction:
          "An arena in 1958 under hanging lamps: a lightweight weightlifter seen from behind holds a loaded barbell overhead at full lockout on a wooden platform; three judges' chairs to the side, a crowd in silhouette beyond. No lettering anywhere.",
        cut: ["weightlifter", "barbell"],
      },
    },
    art: {
      9: {
        direction:
          "Spare pen drawing: three tall flagpoles with their ropes hanging over a three-step victory podium, an official seen from behind reaching for the centre rope, three athletes seen from behind on the podium; lots of white paper.",
        cut: ["podium", "official"],
      },
    },
    notes: { 5: "This chapter now faces an illustration, not a photograph.", 9: "The flag mix-up was a ceremony error; keep it light and factual." },
    frontispiece: { file: "tan-howe-liang-at-the-opening-of-the-yog-learning-centre-sin.jpg", concept: "person" },
  },
  "georgette-chen": {
    photos: {
      1: { label: "The carousel in the Tuileries garden, Paris, today (2012)", tag: "Place", concept: "carousel" },
      4: { label: "Eugene Chen, photographed before 1944", concept: "person", mounted: true },
      5: { label: "Georgette Chen on the cover of Liangyou, 1931", concept: "person", crop: [0, 0.08, 1, 0.92] },
      7: { label: "The Bund, Shanghai, c. 1935", tag: "Place", concept: "building", mounted: true },
      9: { label: "A 1948 Hermes Baby, the model she typed on", tag: "Object", concept: "typewriter" },
      11: { label: "Bumboats on the Singapore River, September 1960", tag: "Place", concept: "boat", mounted: true },
    },
    art: {
      3: {
        direction:
          "Layered paper cut-out of a 1920s Paris academy studio: skylight, plaster casts, a stove, rows of easels; one young woman seen from behind at a canvas turned away from us, a paint box open at her feet. Rooftops of Montparnasse through the glass.",
      },
    },
    notes: {
      5: `${NO_WAR} Leave out Eugene's government post and the prince's later role; the cover and the voyage can stay.`,
      6: `${NO_WAR} End the chapter without the fighting in China: say only that in 1937 the road turned back east, if the facts allow.`,
      7: `${NO_WAR} No officers, arrest, captivity or collaboration. Tell that they could not leave Shanghai, that he kept her beside him, his one-face reply only if it can be told without politics, and his death in May 1944.`,
    },
    breaks: [{ after: 2, file: "dinard-plage-saint-enogat-20210517.jpg", use: { label: "Saint-Enogat beach, Dinard, where she spent childhood summers, today (2021)", tag: "Place", concept: "beach" } }],
    frontispiece: { file: "liangyou-057-cover-zhang-liying.jpg", concept: "person" },
  },
  "sim-wong-hoo": {
    photos: {
      7: { label: "A Sound Blaster 1.0 card, 1989 (photographed 2008)", tag: "Object", concept: "circuit board" },
      9: { label: "A Creative Zen Micro beside an Apple iPod mini, 2005", tag: "Object", concept: "music player" },
      11: { label: "Creative's booth at the E3 trade show, Los Angeles, 2011", tag: "Place", concept: "booth" },
    },
    notes: { 9: "No war or battle metaphors for the business rivalry: a contest, a fight in the shops, a lawsuit." },
    frontispiece: { file: "soundblaster-1-0-ct1320.jpg", concept: "circuit board", depicts: "the Sound Blaster 1.0 card (1989)" },
  },
  "c-kunalan": {
    photos: {
      7: { label: "Sri Mariamman Temple, Singapore, where they married, photographed 2026", tag: "Place", concept: "tower" },
      9: { label: "The Estadio Olímpico Universitario, Mexico City, October 1968", tag: "Place", concept: "stadium" },
      10: { label: "The National Stadium, Kallang, May 2007", tag: "Place", concept: "stadium roof" },
      12: { label: "C. Kunalan at a Singapore Olympic Academy youth session, 2008", concept: "person", mounted: true },
    },
    art: {
      2: {
        direction:
          "Single pen line on cream paper: a hand-chalked oval track on a school field, a starting line of boys seen from behind, a house master's clipboard and whistle in the foreground; a small pennant in a house colour, no words.",
      },
    },
    notes: { 1: `${NO_WAR} Say the family came to Singapore in the late 1940s.`, 2: `${NO_WAR} He taught at Gillman Barracks; leave out who he taught.` },
    frontispiece: { file: "ckunalan-singapore-olympic-academy-youth-session-20081103-01.jpg", concept: "person" },
  },
  "lee-kong-chian": {
    photos: {
      12: { label: "His statue at Hwa Chong Institution, Singapore, 2009", tag: "Place", concept: "statue" },
    },
    replace: {
      6: {
        direction:
          "A 1920s Singapore electric tram at a stop beside shophouses, its open carriages seen from the side; in the third-class carriage a young man in a white suit seen from behind; a rickshaw waits at the kerb.",
        cut: ["tram", "rickshaw"],
      },
      9: {
        direction:
          "A rubber mill being rebuilt: new timber roof trusses over smoke-house racks hung with brown rubber sheets, a lorry at the loading bay, workers seen from behind carrying sheets; a man in a light suit seen from behind at the mill gate.",
        cut: ["man", "lorry"],
      },
    },
    notes: {
      6: "This chapter now faces an illustration, not a photograph.",
      9: `This chapter now faces an illustration, not a photograph. ${NO_WAR} He went to a rubber meeting in the United States in late 1941 and could not get home for almost four years; leave out the invasion and the Korean War (rubber prices rose in the early 1950s). Give it a new title.`,
    },
    breaks: [
      { after: 12, file: "lee-kong-chian-natural-history-museum-nus-singapore.jpg", use: { label: "The Lee Kong Chian Natural History Museum, National University of Singapore, 2015", tag: "Place", concept: "building" } },
    ],
    frontispiece: { file: "statue-of-dr-lee-kong-chian.jpg", concept: "statue", depicts: "his statue at Hwa Chong Institution" },
  },
  "teresa-hsu": {
    photos: {
      1: { label: "Swatow harbour, c. 1869, about thirty years before she was born", tag: "Place", concept: "ship" },
      9: { label: "Kwong Wai Shiu Hospital, Singapore, today (2026)", tag: "Place", concept: "building" },
      11: { label: "The Heart to Heart Service centre, Hougang, 2007", tag: "Place", concept: "building", mounted: true },
      12: { label: "Teresa Hsu at 112, Singapore, 2010", concept: "person" },
    },
    notes: {
      4: `${NO_WAR} Say that when the city became unsafe she gave up the job and joined the Friends' Ambulance Unit, a volunteer service.`,
      5: `${NO_WAR} Brian followed her to London after the unit's work ended; his plane crashed.`,
      6: NO_WAR,
      7: NO_WAR,
    },
    breaks: [
      { after: 10, file: "society-for-the-aged-sick-singapore.jpg", use: { label: "The Society for the Aged Sick, Hougang, successor to the 1965 home, 2007", tag: "Place", concept: "building" } },
    ],
    frontispiece: { file: "teresa-hsu-2010.jpg", concept: "person" },
  },
};
