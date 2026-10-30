# Lives in Motion

Singaporean lives as illustrated books you read by scrolling. Each life is a Part: a cloth cover,
a frontispiece drawn in pen lines, then one spread per chapter, with a caption on the left and on
the right a plate painted in the print style of its decade, cut into layers that move. Every
caption is footnoted with its sources. The books are made with Meta's **Muse Spark**, **Muse
Image** and **SAM 3.1**. It was built for the Meta Global AI Developer Hackathon
(Oct 27 – Nov 4, 2026). Later, the same pipeline could grow into a larger gallery of
biographies.

On the shelf:

| Part | Life | Text | Pictures |
|---|---|---|---|
| One | Jack Sim, "Mr. Toilet" (b. 1957) | Hand-curated from cited sources; every caption checked by Muse Spark | Muse Image + SAM 3.1 |
| Two | Joseph Schooling (b. 1995) | Hand-curated from cited sources; every caption checked by Muse Spark | Muse Image + SAM 3.1 |
| Three | Tan Howe Liang (1933–2024) | Researched and storyboarded by Muse Spark on `/create`; checked by Muse Spark | Muse Image + SAM 3.1 |

Lee Kuan Yew's book is withdrawn from the shelf (`"listed": false`). Its files are kept and the
withdrawal is reversible (`pnpm approve lee-kuan-yew`).

TODO: add fresh screenshots of the book and `/create`. The old `docs/shots` show an earlier
design and are no longer linked.

## Run it

```sh
pnpm install
cp .env.example .env    # MODEL_API_KEY: one key covers Muse Spark, Muse Image and SAM 3.1
pnpm dev                # shelf at /, a book at /jack-sim, the workbench at /create
pnpm test               # schema, sources, eras, SAM decoding, budget guard, /create guard rails, subject screen
pnpm typecheck
```

## The book

The site is one illustrated biography. Home is the front matter and the shelf. Each life opens
from its cloth cover and turns one page per chapter as you scroll (CSS 3D page turns, a ribbon
bookmark on the year rail, ←/→ to turn). The verso has the chapter, year, drop-cap caption and
endnote marks. The recto has the scene's plate, played as a scroll-scrubbed film. Notes and
picture credits close each Part, and the last page turns into the next life. Desktop only for
now. The code is in `components/book/` and `components/StoryPlayer.tsx`.

TODO: a Layers view (the plate separated into the clean background and its SAM 3.1 cut-outs) is
being rebuilt. Document it here once it ships.

## How a life is made

```
name ─▶ screen ─▶ research ─▶ storyboard ─▶ illustrate ─▶ segment ─▶ films
        Muse      Muse Spark    Muse Spark    Muse Image    SAM 3.1     local
        Spark     + web search  json_schema   era style,    cut-outs +  sharp +
        (JSON)    cited facts   7 scenes      plate 1 as    Muse Image  ffmpeg
                                              reference     clean plate
                       verify: Muse Spark + web search re-checks every caption
```

```sh
pnpm make jack-sim --name "Jack Sim" --hint "founder of the World Toilet Organization" --stages research,storyboard
pnpm make jack-sim --stages verify                  # fact-check every caption → verify.json + scene.checked
pnpm make jack-sim --stages illustrate,segment --scenes s4   # redo one scene
pnpm video jack-sim                                 # scroll films, no API calls
```

- **Subject screen** (`/create` only): one Muse Spark JSON call, no web search, about $0.003. It
  says what the named person is mainly known for, and declines politicians, heads of state,
  military figures, lives defined by war, conflict or crime, and private individuals. The decline
  message is shown on the workbench, and nothing is researched or saved.
- **Research:** Muse Spark on the Responses API with `web_search`. Each `YYYY | fact` line keeps
  the `url_citation`s that overlap it, and uncited lines are dropped. Fewer than 7 cited facts
  stops the run.
- **Storyboard:** Muse Spark with a strict JSON schema. Scene sources are copied from the cited
  facts it names, never from the model's own claims. The prompt steers scenes away from politics,
  war and violence.
- **Verify:** Muse Spark with web search fact-checks each caption. Each verdict (`ok`,
  `disputed` or `corrected`), with its model, time and cited URLs, is stored in the scene's
  `checked` field and in `stories/<slug>/verify.json`.
- **Illustrate:** Muse Image, one square plate per scene, prompted with the era preset's print
  technique and palette. Plate 1 is the style reference for the rest.
- **Segment:** SAM 3.1 cuts out each concept ("toilet", "globe") as an alpha cut-out placed where
  it was found. A Muse Image edit then repaints the clean background behind it.
- **Frontispiece:** a credited photo, or a Muse Image emblem for lives made on `/create`. A SAM 3.1
  mask is traced into pen strokes by linedraw and drawn stroke by stroke with vivus.
- **Films:** `pipeline/video.ts` renders a 3.5 s depth push per scene locally (every frame a
  keyframe, so scroll seeking is instant).

## Make a new life (`/create`)

Type a Singaporean's name (plus an optional hint, and a photo you have the right to use) and
watch the models work. The workbench shows:

- the subject screen's verdict;
- Muse Spark's cited facts as they arrive;
- seven plate slots filling as Muse Image paints them;
- SAM 3.1 cut-outs lighting up over each plate;
- a press log naming the model and cost of every artifact.

*Read the book* opens `/<slug>` as soon as the first plate exists. A real run takes 7–13 minutes
and about $0.35–0.40.

**Drafts.** A life made on `/create` is written with `"listed": false`. It can be read at its URL
at once, but it stays off the shelf and out of the Part chain until the owner runs
`pnpm approve <slug>`. Run `pnpm approve` with no slug to list the drafts, and add `--withdraw` to
take a life off the shelf again.

**Rehearse for free.** In development, or with `CREATE_MOCK=1`, the *Rehearse* button replays
Jack Sim's finished life through the same events, including a declined scene and a retried call.
It runs under Jack Sim's own name, needs no name typed, makes no Meta calls and charges nothing.

Guard rails, because a public page that spends real money is a risk:

- Real runs are on only when `NODE_ENV !== "production"` or `ALLOW_CREATE=1`. `CREATE_TOKEN`
  adds a passcode. Rehearsals need neither.
- One life at a time (409).
- Each visitor (by IP) gets 2 real lives a day (`CREATE_PER_IP_DAILY`, 429). Rehearsals are not
  counted.
- A run is refused if the budget guard has less than $2 of headroom (402), or if today's
  `/create` spend plus one life's $1.50 ceiling would pass `CREATE_DAILY_USD` (default $10, 429).
- Name ≤ 80 characters, hint ≤ 120, no links or markup.
- Photos ≤ 8 MB, JPEG, PNG or WebP checked by their bytes, re-encoded (EXIF and GPS dropped), and
  accepted only with the rights box ticked.

Code: `pipeline/create/` (runner, guard rails, subject screen, job types), `app/api/create/`
(routes, including Server-Sent Events) and `app/create/` with `components/create/` (the page).

## Budget

The event allowance is $150. Every Meta call goes through `pipeline/budget.ts`. It prices the
call's worst case, refuses the call if the ledger would pass **$135** ($15 is kept in reserve),
and records the real cost from the response's usage in `spend.jsonl` (committed). `pnpm spend`
prints the totals.

## Built during the hackathon

Everything in this repository was made during the event (Oct 27 – Nov 4, 2026). Nothing predates
it.

- **First commit:** `f8d2754`, 2026-10-30 00:13 JST (2026-10-29 15:13 UTC). The full timeline is
  in `git log --reverse`.
- **First paid Meta call:** 2026-10-30 01:25 UTC (`spend.jsonl`, line 1).
- **Hand-curated text:** the first commit's lives (Jack Sim, Joseph Schooling, Lee Kuan Yew) were
  written from cited sources (NLB Infopedia, the Straits Times, the UN, Wikipedia) before any Meta
  call. Their captions have since been fact-checked by Muse Spark. Tan Howe Liang's text is
  entirely model-made.

What each Meta model made, counted from the files and the ledger (2026-10-30):

| Model | Artifacts | Count |
|---|---|---|
| Muse Spark + web search | Tan Howe Liang's research: cited facts | 17 facts from 1 research call |
| Muse Spark (JSON) | Tan Howe Liang's storyboard: 7 scenes, tagline, emblem brief | 1 |
| Muse Spark + web search | Caption fact-checks (`verify.json`, `scene.checked`) for the three lives on the shelf | 21 (19 ok, 2 corrected) |
| Muse Spark (JSON) | `/create` subject screens | 1 (a test decline) |
| Muse Image | Scene plates, era-styled, plate 1 as style reference | 28 (7 × 4 lives) |
| Muse Image (edit) | Clean backgrounds behind the cut-outs | 28 |
| Muse Image | Frontispiece emblem (Tan Howe Liang) | 1 |
| SAM 3.1 | Scene cut-outs (alpha WebP) | 35 |
| SAM 3.1 | Person masks for the three photo frontispieces, plus 1 emblem mask | 4 |
| Muse Wonder | TODO: fill in once the Muse Wonder film work lands | — |

The 4 lives include Lee Kuan Yew, who is withdrawn. Made locally with no model: 28 scroll films
(sharp + ffmpeg), 8 pen-line scene drawings and 4 frontispiece line drawings (linedraw).

On the evening of 2026-10-30 the ledger had 182 calls and **$2.22** spent: SAM 3.1 96 calls,
$0.24; Muse Image 58, $0.58; Muse Spark with search 23, $1.31; Muse Spark 2, $0.03; Muse Wonder 2,
$0.05. That is more calls than artifacts because of retries, misses and fallbacks. `pnpm spend` shows the live total.

### Third-party material

| What | Licence | Where |
|---|---|---|
| [linedraw](https://github.com/LingDong-/linedraw) by Lingdong Huang | MIT | Vendored in `pipeline/vendor/linedraw` (with its LICENSE), one option added |
| [vivus](https://github.com/maxwellito/vivus) | MIT | npm dependency; draws the line portraits |
| `@meta-sam/parser` | SAM License (Meta) | npm dependency; decodes SAM 3.1 masks |
| Fonts: Archivo, Instrument Serif, Newsreader, IBM Plex Mono | SIL OFL 1.1 | `next/font/google` |
| Jack Sim photo, by Clorox Toilet Products | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) | [Commons](https://commons.wikimedia.org/wiki/File:Jack_Sim_(WTO,_2010)_-_2.jpg) |
| Joseph Schooling photo, by Oleg Bkhambri (Voltmetro) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Commons](https://commons.wikimedia.org/wiki/File:Joseph_Schooling_Kazan_2015.jpg). The traced drawing, its mask and its WebP are shared under CC BY-SA 4.0 too. |
| Lee Kuan Yew photo, by the Australian News and Information Bureau | Public domain | [Commons](https://commons.wikimedia.org/wiki/File:Lee_Kuan_Yew_at_the_1969_Five_Power_Defence_Conference_(5).jpg) (life withdrawn) |

The photo credits are also in `pipeline/portraits/credits.json` and in each book's picture
credits. Figures in the plates are silhouettes or seen from behind, so no likeness of a real
person is generated.

## Rules the content follows

- Every scene cites at least one source, and the notes list them all.
- Figures are silhouettes or seen from behind. No faces are generated.
- No politicians, heads of state, or lives defined by war or crime.
- Captions stay under about 30 words. `prefers-reduced-motion` gets a still, readable book.

## Layout

| Path | What |
|---|---|
| `stories/<slug>/story.json` | The life: scenes, captions, sources, layers, fact-check verdicts, `listed` |
| `stories/<slug>/verify.json` | Muse Spark's fact-check of every caption, with cited URLs |
| `app/` | Next.js pages: home and shelf, one book per life, `/create` and its API |
| `components/` | The book, scene art, scroll films, line drawings, the `/create` workbench |
| `lib/schema.ts` | Story schema (zod), the contract between pipeline and site |
| `lib/stories.ts` | `allStories()` (the shelf), `getStory()`, `readingOrder()` (drafts open by URL) |
| `pipeline/` | Meta Model API client, budget guard, prompts, stages, SAM cut-outs, portraits, films, CLI |
| `spend.jsonl` | Ledger of every paid Meta call |

## Licence

MIT © 2026 ong6, for the code (see `LICENSE`). Third-party material keeps its own licence (above).
