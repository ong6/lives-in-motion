# Design

## Site and book

The home page is the publisher's site for the series; the book is only where a life is read.

| Surface | What it is | Book-only elements? |
|---|---|---|
| **Home** (`app/page.tsx`) | Daylight paper. Hero: the title set large beside one real plate from each life, taken apart into its Muse Image background and SAM 3.1 cut-outs in turn (`components/home/HeroPlate.tsx`). *On the shelf*: the books spine-out in one row on a board (`components/home/Shelf.tsx`). Each spine is cloth in its life's colour with raised bands and gilt fillets, a band cropped from the first plate, the name in gilt down its length and the dates at the foot; thickness and height vary a little with page count. The first book always stands half out with its cover showing and a pencilled "Pull a book to read it". Hover or focus pulls a book: it slides out and turns its cover to the reader, only the books after it move over (so nothing moves under the pointer), its neighbours lean, and its name, tagline and chapters are set beside the row. Label cards under the board name every book, so the row reads without hovering. Two undyed linen blanks close the row: *A new life* (`/create`) and *Your family's story* (`/family`). *How a page is made*: one real scene taken apart, each stage labelled with the Meta model that made it (Muse Spark research and sources, Muse Image plate, SAM 3.1 cut-out on a transparency grid, Muse Image clean plate, Muse Wonder's film with its cost and rounds; the film's poster is preloaded so the frame is never blank). *Make a new life*: the one band of colour, linking `/create`. Footer: epigraph, colophon, photo credits. | No |
| **Story** (`app/[slug]`, `components/book/`) | The book on a desk under a lamp: walnut tinted by the era's ink, grain and vignette in one fixed layer. One gesture turns one leaf: cover, endpapers, frontispiece and title, a spread per chapter, notes. Then the book changes to the next life, or, for the last life, the back endpapers and the back cover closing. | Folios, running heads, ribbon, page turns, Layers |

Both routes render per request, so a life written by `/create` is on the shelf and readable at once.
A life without a line portrait gets its first plate as the frontispiece (or a monogram); a plate
not made yet shows its year and "still being made".

## Transitions

- **Shelf to book.** The shelf cover and the story's closed cover share the view-transition name
  `cover-<slug>` (`components/book/Cover.tsx`, React `<ViewTransition share="lift">`). While the
  book is shut only its cover is drawn, so the cover flies from the shelf onto an empty desk.
- **One book down, the next off the shelf (about 2.9 s).** The lives are separate books, each
  with its own folios (title page = page 1); there are no Parts. Turning on from the notes plays
  the change on the outgoing page, using the next life's data (the page receives both lives). The rest of the
  pages and the back board swing over and the closed book centres. It is then pushed off to the
  left, tilting and shrinking a little. The desk retints to the next life's first era. The
  next book, in its own cloth, slides in from the right and settles. Its cover opens and the
  endpaper leaf turns, straight to its title spread. Only then does `router.push('/<next>?from=turn')`
  run. The new page opens at that same spread (`useLayoutEffect`, before paint) and carries on
  the title's entrance from the moment it started (a module-level handoff), so the route change
  is invisible. Input during the change is dropped, never queued, so it always lands on the next
  book's title spread; the wheel gesture state is module-level so a flick's tail can't reach the
  new page, and the new page ignores the wheel for 450 ms after the change. Under reduced motion
  it is a straight cut.
- **Shelf to book shadow.** While the book is shut the board's drop shadow lives on the cover
  element itself, so it flies in with the cover instead of waiting on the desk.
- **The end.** The last life closes: the back board turns over and the book slides to centre,
  showing the back cover with links to the shelf and to `/create`.

## Era presets (`lib/eras.ts`)

| Era | Years | Print technique |
|---|---|---|
| Colonial port | 1819–1941 | Copperplate engraving, sepia |
| Occupation | 1942–1945 | Wartime woodcut, one red |
| Road to merdeka | 1946–1964 | 1950s lithograph poster |
| Nation building | 1965–1989 | 1970s silkscreen campaign poster |
| Global city | 1990–2009 | 1990s risograph, orange and teal |
| Now | 2010– | Contemporary cut-paper collage |

The same preset fills the CSS variables and the Muse Image prompt, so the generated art and the
interface agree.

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
  for 170 ms, its deltas jump up again (a new flick), or, 200 ms after the page has landed, a
  push of 24 px or more arrives that is not dying away (a mouse wheel's next notch; trackpad
  inertia is by then a few px and falling). So inertia never turns a second page, and every
  gesture turns exactly one. The rail and the note markers riffle through several leaves (+150 ms per leaf, up to
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
- **Layers.** "Layers" under a plate, or the L key (Esc closes), takes the plate apart over the
  whole open spread (`LayerStack`, rendered by the book so it can leave the page). The verso dims
  under a sheet of paper; the plate tilts back off the recto across the gutter at about two thirds
  scale, and its real sheets lift off one at a time (380 ms apart), bottom to top: Muse Image's
  clean plate, each SAM 3.1 cut-out at its depth, anything drawn in code, and for a line scene
  the line drawing. Each label (25 px name, 16 px credit) faces the reader from its sheet's left
  corner, out over the dimmed verso, so none can clip at the fore-edge. Once the sheets are apart
  the verso shows the **director's card** (`components/book/Direction.tsx`, data read on the server
  from `public/stories/<slug>/<id>/motion.json` and `wonder.json` by `direction.server.ts`): Muse
  Wonder's rationale, its camera move drawn over the plate (each keyframe's frame, dotted corner
  and centre paths, keyframe dots, a viewfinder playing the move), the critic's score, a dot per
  round with the kept one filled, its verdict on six frames, any plate fault it flagged, model,
  cost and date. A scene whose critic never passed a plan says so ("Reviewed by Muse Wonder"; the
  film kept the standard push-in). Line scenes have no card. Toggling again, or turning the page,
  lays the sheets back down.
- **Fact-checks.** Under each caption a quiet "✓ Checked by Muse Spark" mark; hover or focus opens
  the verdict, date, Spark's note and the cited hosts. The notes list each chapter's check and its
  sources.
- **Recording.** `?record` on any URL (sticky for the tab; `?record=0` ends it) sets
  `data-recording` on `<html>`, hiding the Next dev badge and anything marked `data-record-hide`.

## The deep edition

Twelve chapters told as a story, with real photographs between the plates (`edition: "deep"`).

- **Text page.** The year (or "c. 1963") and "aged 44", the chapter number, the title, a body of
  90–150 words with a drop cap, and the voice line set large as a pull-quote (with its speaker
  and source when it is the chapter's quotation). Muse Spark's check mark sits under it. Sized so
  150 words fit at full size; the `--fit` guard is a backstop.
- **The turn.** The last line on the page you turn (the text recto of a photo chapter, or under
  the plate of a plate chapter), with a rule above and an arrow: one sentence that pulls into the
  next chapter.
- **Photo chapter.** The photo is on the verso, the text on the recto. A good, large photo bleeds
  off the page, cropped around SAM 3.1's mask of its subject; a small or poor one is mounted as a
  print with a mat and a slight tilt. On the entrance the pen trace draws over a pale wash of the
  photo, the photo develops underneath, and the trace settles to a light overlay. Its label and
  credit (artist, licence, source; "Pen trace shared under CC BY-SA" where the photo is
  share-alike) sit on the page; a photo that is not the person carries a boxed **Place** /
  **Object** tag.
- **Breaks.** An occasional photograph printed across both pages between two chapters, for
  pacing; both halves draw nearer together as the leaf lands.
- **Layers on a photo.** The photo's place empties to paper; the photo, SAM 3.1's cut-out and the
  pen trace lift off toward the recto (which dims), labels facing out from the right corners, and
  a card on the recto says where the photo came from and what each sheet is.
- **Notes.** Two spreads: the chapters' sources and checks, then *Where the sources differ* (the
  reading the book follows); every photograph with its page, maker and licence, then *On the
  pictures*.
- **Rail.** Twelve years; a dot marks the chapters that open on a photograph.

## Motion rules

- The story book: see *The book stage* above.
- Back layers settle first; nearer layers enter later and travel further (parallax by `depth`).
- `prefers-reduced-motion`: turns and the book change are instant cuts, entrances and the idle
  motion are off, and films show their finished still (a line film shows the plate, not its
  first frame). The home page's reveals and hero show their final state.

## Hackathon angle

- **Theme:** *Build for Your World*. Singapore's stories exist as text (Infopedia) but not as
  something people want to watch.
- **The demo moment:** press *Layers*. The plate tilts off the page and its sheets lift one by one,
  each labelled with the model that made it, while Muse Wonder's card shows how it directed the
  film and what its critic said. Spark → Image → SAM → Wonder in one picture.
- **Second beat:** type a new name and watch research, storyboard, plates and cut-outs fill in.
- **Third beat: "your family's story"** (`/family`). A grandparent's recording replaces web
  research: Muse Voice Transcribe writes it down, Muse Spark cites each fact to the second it was
  said, and the book stays private (unlisted, deletable). Family photos are only traced, never
  generated from, so no face is made up. It fits the theme exactly and avoids the public-figure
  likeness issue, because the family consents.
