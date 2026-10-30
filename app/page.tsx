import Link from "next/link";
import type { CSSProperties } from "react";
import type { Scene, Story } from "@/lib/schema";
import { allStories, lifespan } from "@/lib/stories";
import { portraitCredit, portraitSrc } from "@/lib/portraits";
import { eraFor } from "@/lib/eras";
import { LineDrawing } from "@/components/LineDrawing";
import { LoopFilm } from "@/components/LoopFilm";
import { Cover, clothFor } from "@/components/book/Cover";
import { PART, roman } from "@/components/book/pagination";
import s from "./home.module.css";

// The shelf lists whatever is in stories/ now, including lives made on /create since the server started.
export const dynamic = "force-dynamic";

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const count = (n: number) => WORDS[n] ?? String(n);

/** The scene the making section takes apart: the first one every stage has been run on. */
function showcase(stories: Story[]): { story: Story; scene: Scene; index: number } | undefined {
  for (const story of stories)
    for (const [index, scene] of story.scenes.entries())
      if (scene.plate && scene.background && scene.video && scene.layers.some((l) => l.src)) return { story, scene, index };
}

export default function Home() {
  const stories = allStories();
  const first = stories[0];
  const demo = showcase(stories);

  return (
    <div className={s.site}>
      <header className={s.masthead}>
        <Link href="/" className={s.wordmark}>
          Lives in Motion
        </Link>
        <nav aria-label="Site">
          <a href="#shelf">The shelf</a>
          <a href="#making">How a page is made</a>
          <Link href="/create">Make a new life</Link>
        </nav>
      </header>

      <main>
        {/* ---------- Hero ---------- */}
        <section className={s.hero}>
          <div className={s.heroText}>
            <h1 className={s.heroTitle}>Lives in Motion</h1>
            <p className={s.pitch}>
              Singaporean lives as illustrated books you read by scrolling. Every scene is sourced, and every picture is made with Meta’s
              AI.
            </p>
            {first && (
              <div className={s.heroActions}>
                <Link href={`/${first.slug}`} className={s.primary}>
                  Open {first.name}’s book
                </Link>
                <a href="#making" className={s.quiet}>
                  See how a page is made
                </a>
              </div>
            )}
          </div>
          {first && (
            <figure className={s.heroPlate}>
              <div className={s.heroArt}>
                <LineDrawing
                  src={portraitSrc(first.slug)}
                  loop
                  label={`${first.name}, drawing himself in pen strokes`}
                  fallback={first.scenes[0].plate ? <img className={s.heroFallback} src={first.scenes[0].plate} alt="" /> : null}
                />
              </div>
              <figcaption>
                <i>{first.name}</i>, drawn stroke by stroke the way a pen plotter would. As the last lines land, the photograph they were
                traced from develops underneath, cut out by SAM 3.1. {portraitCredit(first.slug)}
              </figcaption>
            </figure>
          )}
        </section>

        {/* ---------- The shelf ---------- */}
        <section id="shelf" className={s.shelfSection} aria-labelledby="shelf-title">
          <div className={s.sectionHead}>
            <h2 id="shelf-title">On the shelf</h2>
            <p>
              {count(stories.length)} {stories.length === 1 ? "life" : "lives"} so far, each bound in the colours of the decade it starts
              in. Take one down to read it; each book runs on into the next.
            </p>
          </div>
          <ol className={s.shelf}>
            {stories.map((st, i) => {
              const era = eraFor(st.scenes[0].year);
              const years = `${st.scenes[0].year} to ${st.scenes.at(-1)!.year}`;
              return (
                <li key={st.slug} className={s.slot}>
                  <div className={s.bookArea}>
                    <Link href={`/${st.slug}`} className={s.volumeLink} aria-label={`Open ${st.name}’s book`}>
                      <div className={s.volume} style={{ ["--cloth" as string]: clothFor(era, i) } as CSSProperties}>
                        <span className={s.spine} aria-hidden>
                          <span>{st.name}</span>
                        </span>
                        <Cover
                          slug={st.slug}
                          name={st.name}
                          lifespan={lifespan(st)}
                          part={`Part ${PART[i] ?? i + 1}`}
                          className={s.front}
                        />
                      </div>
                    </Link>
                  </div>
                  <div className={s.label}>
                    <h3>
                      <Link href={`/${st.slug}`}>{st.name}</Link>
                    </h3>
                    <p className={s.labelTag}>{st.tagline}</p>
                    <p className={s.labelMeta}>
                      {count(st.scenes.length)} chapters, {years}
                    </p>
                  </div>
                </li>
              );
            })}
            <li className={s.slot}>
              <div className={s.bookArea}>
                <Link href="/create" className={s.volumeLink} aria-label="Make a new life">
                  <div className={`${s.volume} ${s.blank}`}>
                    <span className={s.spine} aria-hidden />
                    <div className={s.front}>
                      <span className={s.blankMark} aria-hidden>
                        +
                      </span>
                    </div>
                  </div>
                </Link>
              </div>
              <div className={s.label}>
                <h3>
                  <Link href="/create">A new life</Link>
                </h3>
                <p className={s.labelTag}>Type a name; the book is written, painted and bound here.</p>
              </div>
            </li>
          </ol>
        </section>

        {/* ---------- How a page is made ---------- */}
        {demo && (
          <section id="making" className={s.making} aria-labelledby="making-title">
            <div className={s.sectionHead}>
              <h2 id="making-title">How a page is made</h2>
              <p>
                One plate from {demo.story.name}’s book, {demo.scene.year}: <i>{demo.scene.title}</i>. Each stage below is the real file the
                model returned, unretouched.
              </p>
            </div>
            <ol className={s.stages}>
              <li className={s.stage}>
                <p className={s.model}>
                  <b>Muse Spark</b> researches
                </p>
                <div className={`${s.frame} ${s.research}`}>
                  <p className={s.researchYear}>{demo.scene.year}</p>
                  <p className={s.researchText}>{demo.scene.caption}</p>
                  <ul className={s.sources}>
                    {demo.scene.sources.map((src) => (
                      <li key={src.url}>
                        <a href={src.url} target="_blank" rel="noopener noreferrer">
                          {src.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className={s.stageNote}>Searches the web, writes the dated timeline and cites it. A line without a source is dropped.</p>
              </li>
              <li className={s.stage}>
                <p className={s.model}>
                  <b>Muse Image</b> paints the plate
                </p>
                <div className={s.frame}>
                  <img src={demo.scene.plate} alt={`Plate: ${demo.scene.visual}`} />
                </div>
                <p className={s.stageNote}>From Muse Spark’s art direction, in the print style of the decade.</p>
              </li>
              <li className={s.stage}>
                <p className={s.model}>
                  <b>SAM 3.1</b> cuts it apart
                </p>
                <div className={`${s.frame} ${s.cutouts}`}>
                  {demo.scene.layers
                    .filter((l) => l.src)
                    .map((l) => (
                      <img key={l.id} src={l.src} alt={`Cut-out: ${l.concept}`} />
                    ))}
                </div>
                <p className={s.stageNote}>
                  Finds “
                  {demo.scene.layers
                    .filter((l) => l.src)
                    .map((l) => l.concept)
                    .join("”, “")}
                  ” in the plate and cuts it out, so it can move on its own.
                </p>
              </li>
              <li className={s.stage}>
                <p className={s.model}>
                  <b>Muse Image</b> clears the stage
                </p>
                <div className={s.frame}>
                  <img src={demo.scene.background} alt="The plate with the cut-out removed" />
                </div>
                <p className={s.stageNote}>Edits the plate to paint out what SAM cut, leaving the empty set behind it.</p>
              </li>
              <li className={s.stage}>
                <p className={s.model}>
                  <b>The book</b> sets it moving
                </p>
                <div className={s.frame}>
                  <LoopFilm src={demo.scene.video!} poster={demo.scene.poster} label={`Scene film: ${demo.scene.visual}`} />
                </div>
                <p className={s.stageNote}>No model here: each layer is moved by its depth into a film your scrolling plays.</p>
              </li>
            </ol>
            <blockquote className={s.direction}>
              <p>“{demo.scene.visual}”</p>
              <footer>The art direction Muse Spark wrote and Muse Image painted from.</footer>
            </blockquote>
            <p className={s.makingMore}>
              <Link href={`/${demo.story.slug}`}>
                See it in Chapter {roman(demo.index + 1)} of {demo.story.name}’s book
              </Link>
            </p>
          </section>
        )}

        {/* ---------- Make a new life ---------- */}
        <section id="make" className={s.make} aria-labelledby="make-title">
          <div className={s.makeText}>
            <h2 id="make-title">Make a new life</h2>
            <p>
              Type a Singaporean’s name. Muse Spark researches the life with cited sources, Muse Image paints seven plates, SAM 3.1 cuts
              them into layers, and the book is bound and put on this shelf while you watch.
            </p>
            <Link href="/create" className={s.makeCta}>
              Start a book
            </Link>
          </div>
          <ol className={s.makeSteps}>
            <li>
              <b>Name</b> Who should the book be about?
            </li>
            <li>
              <b>Research</b> Muse Spark finds and cites the life, decade by decade.
            </li>
            <li>
              <b>Plates</b> Muse Image paints seven scenes.
            </li>
            <li>
              <b>Layers</b> SAM 3.1 cuts out what should move.
            </li>
          </ol>
        </section>
      </main>

      {/* ---------- Colophon ---------- */}
      <footer className={s.footer}>
        <blockquote className={s.epigraph}>
          <p>
            A biography is considered complete if it merely accounts for six or seven selves, whereas a person may well have as many
            thousand.
          </p>
          <footer>
            Virginia Woolf, <cite>Orlando</cite> (1928)
          </footer>
        </blockquote>
        <div className={s.colophon}>
          <h2>Colophon</h2>
          <p>
            <i>Lives in Motion</i> was made for the Meta Global AI Developer Hackathon, 2026. Research by Muse Spark with web search; plates
            and clean backgrounds by Muse Image; cut-outs and portrait masks by SAM 3.1. Facts link to their sources in the notes at the end
            of each life.
          </p>
          <p>
            Portraits are traced into pen strokes with linedraw and drawn with vivus; people in the scenes are silhouettes by design. Set in
            Instrument Serif and Newsreader.
          </p>
          <ul className={s.credits}>
            {stories.map((st) => {
              const c = portraitCredit(st.slug);
              return c ? (
                <li key={st.slug}>
                  <i>{st.name}.</i> {c}
                </li>
              ) : null;
            })}
          </ul>
        </div>
      </footer>
    </div>
  );
}
