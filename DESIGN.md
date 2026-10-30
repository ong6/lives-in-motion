# Design

## Site and book

The home page is the publisher's site for the series; the book is only where a life is read.

| Surface | What it is | Book-only elements? |
|---|---|---|
| **Home** (`app/page.tsx`) | Daylight paper. Hero: the title set large beside a line portrait that draws itself on a loop. *On the shelf*: every life in `stories/` as a closed book standing on a ledge, spine showing, bound in its first era's cloth (neighbours alternate the era's two inks); hover or focus turns it to face you and lifts it. *How a page is made*: one real scene taken apart, each stage labelled with the Meta model that made it (Muse Spark research and sources, Muse Image plate, SAM 3.1 cut-out on a transparency grid, Muse Image clean plate, the scroll film). *Make a new life*: the one band of colour, linking `/create`. Footer: epigraph, colophon, photo credits. | No |
| **Story** (`app/[slug]`, `StoryPlayer`) | The book on a desk under a lamp: walnut tinted by the era's ink, grain and vignette in one fixed layer. One gesture turns one leaf: cover, endpapers, frontispiece and title, a spread per chapter, notes. Then the book changes to the next life, or, for the last life, the back endpapers and the back cover closing. | Folios, running heads, ribbon, page turns, Layers |

Both routes render per request, so a life written by `/create` is on the shelf and readable at once.
A life without a line portrait gets its first plate as the frontispiece (or a monogram); a plate
not made yet shows its year and "still being made".

## Transitions

- **Shelf to book.** The shelf cover and the story's closed cover share the view-transition name
  `cover-<slug>` (`components/book/Cover.tsx`, React `<ViewTransition share="lift">`). While the
  book is shut only its cover is drawn, so the cover flies from the shelf onto an empty desk.
- **One life into the next (about 2.9 s).** Turning on from the notes plays the change on the
  outgoing page, using the next life's data (the page receives both lives). The rest of the
  pages and the back board swing over and the closed book centres. It is then pushed off to the
  left, tilting and shrinking a little. The desk retints to the next life's first era. The
  next book, in its own cloth, slides in from the right and settles. Its cover opens and the
  endpaper leaf turns, straight to its title spread. Only then does `router.push('/<next>?from=turn')`
  run. The new page opens at that same spread (`useLayoutEffect`, before paint) and carries on
  the title's entrance from the moment it started (a module-level handoff), so the route change
  is invisible. Any new input skips to the end. Under reduced motion it is a straight cut.
- **Shelf to book shadow.** While the book is shut the board's drop shadow lives on the cover
  element itself, so it flies in with the cover instead of waiting on the desk.
- **The end.** The last life closes: the back board turns over and the book slides to centre,
  showing the back cover with links to the shelf and to `/create`.

## Directions

All three share one stage, one story file and one set of era presets; a reader can switch.

| Direction | Look | Motion | Use |
|---|---|---|---|
| **Paper Theatre** (default) | A shophouse proscenium: scalloped valance, side wings, floorboards in era colours. Layers are paper puppets with a hard drop shadow. Caption on a torn paper ticket. | Layers slide in from the wings, drift by depth, exit to alternating sides. | The hackathon demo: shows every model's output, and the paper look forgives rough SAM edges. |
| **Living Archive** | A museum catalogue: each scene is a numbered plate with a double rule, multiply-blended and desaturated; caption as a museum label. | Ink-bleed reveal (clip-path), slow parallax. | The calm, credible reading mode. |
| **Era Shift** | Full bleed. The interface itself (page colour, display face, controls) takes on the decade of the scene. | Colours cross-fade between eras; giant year numerals. | The most distinctive; best on long lives that cross eras (Lee Kuan Yew). |

## Era presets (`lib/eras.ts`)

| Era | Years | Print technique | Easing |
|---|---|---|---|
| Colonial port | 1819–1941 | Copperplate engraving, sepia | power2.out, 1.4 s |
| Occupation | 1942–1945 | Wartime woodcut, one red | power3.inOut, 1.2 s |
| Road to merdeka | 1946–1964 | 1950s lithograph poster | power2.out, 1.1 s |
| Nation building | 1965–1989 | 1970s silkscreen campaign poster | back.out, 0.9 s |
| Global city | 1990–2009 | 1990s risograph, orange and teal | power3.out, 0.8 s |
| Now | 2010– | Contemporary cut-paper collage | expo.out, 0.7 s |

Older eras move slower and heavier. The same preset fills the CSS variables and the Muse Image
prompt, so the generated art and the interface agree.

## The book stage

- **Fixed design size.** The stage is laid out once at 1600 × 1000 (the page is 660 × 880, the
  spread nudged 41 px left so the ribbon rail fits). It is scaled to fit the window with
  `scale: min(100vw/1600px, 100svh/1000px)`, using `tan(atan2())` to turn the ratio into a
  number. Type is set in fixed design pixels, so a page looks the same at every window size.
  The desk fills the letterbox. A `--fit` guard steps a chapter's or the notes' type down if a
  long caption made on `/create` would overflow.
- **Paged, not scrolled.** The document does not scroll. Each input turns one leaf: a wheel or
  trackpad gesture (40 px of travel commits; less only lifts the leaf about 18° as a peek and
  springs back), ←/→/↑/↓/PgUp/PgDn/Space, Home/End, or a swipe. A turn takes 820 ms on a cubic
  Bézier curve (0.45, 0, 0.18, 1). The leaf lifts 20 px, leans its free edge, darkens toward
  the spine, carries a band of lamplight, and casts a shadow that fades as it lands. Input is
  locked until the turn lands. The rest of that gesture is then swallowed until the wheel pauses
  for 170 ms or its deltas jump up again (a new flick), so trackpad inertia never turns a second
  page. The rail and the note markers riffle through several leaves (+150 ms per leaf, up to
  1.7 s). The spread at rest is kept in the URL as `#p=N`, so Back and refresh reopen it.
- **A spread's entrance.** Once a leaf passes upright, the new spread plays a short sequence
  from a per-spread clock (`useTimeline`), not from scroll. The year is stamped in, the title
  rises, the caption inks in line by line (a moving mask), and the note marker pops last. The
  plate settles from a slight push-in, and then:
  - a film plays through once and holds on its last frame;
  - an archive print inks up from the bottom, then plays;
  - a line film draws its strokes, then develops the plate;
  - a plate without a film lifts its SAM cut-outs in by depth.

  At rest the plate breathes slowly and leans a few pixels toward the pointer, deeper layers
  further. Glimpsed under a lifting leaf, a spread always shows its finished state.
- **Layers.** "Layers" under a plate, or the L key, tilts the plate back and separates it into
  its real sheets. From the bottom: Muse Image's clean plate, each SAM 3.1 cut-out at its depth
  (labelled with its concept), anything drawn in code, and for a line scene the line drawing.
  Each sheet carries a label that faces the reader. Toggling again, or turning the page, lays
  them back down.

## Motion rules

- The story book: see *The book stage* above. (The older pinned-scroll GSAP model below
  describes the three directions, not the book.)
- One pinned stage; scroll scrubs a GSAP timeline (enter 0.4, hold 0.4, exit 0.3 per scene).
- Back layers settle first; nearer layers enter later and travel further (parallax by `depth`).
- Text never animates more than a fade and a 14 px rise.
- `prefers-reduced-motion`: no pinning, scenes stacked as stills with captions. In the book,
  turns and the book change are instant cuts, entrances and the idle motion are off, and films
  show their finished still (a line film shows the plate, not its first frame).

## Hackathon angle

- **Theme:** *Build for Your World*. Singapore's stories exist as text (Infopedia) but not as
  something people want to watch.
- **The demo moment:** press *Layers*. The scene tilts and the SAM 3.1 cut-outs separate in depth,
  each labelled with the concept it was cut by. It shows Spark → Image → SAM working together in one picture.
- **Second beat:** type a new name and watch research, storyboard, plates and cut-outs fill in.
- **Stretch: "your family's story".** Swap web research for a voice interview with a grandparent
  (Muse Spark takes audio) and family photos as Muse Image references. That fits the theme exactly
  and avoids the public-figure likeness issue, because the family consents.
