import Link from "next/link";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CSSProperties } from "react";
import type { Scene, Story } from "@/lib/schema";
import type { Job } from "@/pipeline/create/types";
import { PRICES } from "@/pipeline/budget";
import { allStories, lifespan } from "@/lib/stories";
import { portraitCredit } from "@/lib/portraits";
import { eraFor } from "@/lib/eras";
import { LoopFilm } from "@/components/LoopFilm";
import { Cover, clothFor } from "@/components/book/Cover";
import { PART, roman } from "@/components/book/pagination";
import { HeroPlate, type HeroScene } from "@/components/home/HeroPlate";
import { Masked } from "@/components/home/Masked";
import { Reveal } from "@/components/home/Reveal";
import s from "./home.module.css";

// The shelf lists whatever is in stories/ now, including lives made on /create since the server started.
export const dynamic = "force-dynamic";

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const count = (n: number) => WORDS[n] ?? String(n);
const lower = (n: number) => count(n).toLowerCase();
const usd = (n: number) => `$${n < 0.01 ? n.toFixed(4).replace(/0$/, "") : n.toFixed(2)}`;

const cuts = (scene: Scene) => scene.layers.filter((l): l is typeof l & { src: string } => Boolean(l.src));

/** The /create job that made a life, when it was made on this site (not a rehearsal). */
function jobFor(slug: string): Job | undefined {
  const f = join(process.cwd(), "stories", slug, "job.json");
  if (!existsSync(f)) return undefined;
  try {
    const job = JSON.parse(readFileSync(f, "utf8")) as Job;
    return job.status === "done" && !job.mock ? job : undefined;
  } catch {
    return undefined;
  }
}

/** Minutes from the first call to the last file written. */
function minutes(job: Job): number {
  const ends = Object.values(job.steps)
    .map((st) => (st.endedAt ? Date.parse(st.endedAt) : 0))
    .concat(Date.parse(job.finishedAt ?? job.updatedAt));
  return Math.max(1, Math.round((Math.max(...ends) - Date.parse(job.startedAt)) / 60000));
}

/**
 * The plate each life shows in the hero: one whose every layer is a SAM cut-out (no drawn
 * overlays), preferring more cut-outs and bigger ones, so the picture comes apart well.
 */
function heroScene(story: Story): HeroScene | undefined {
  let best: { scene: Scene; index: number; score: number } | undefined;
  for (const [index, scene] of story.scenes.entries()) {
    const layers = cuts(scene);
    if (!scene.plate || !scene.background || !layers.length || layers.length !== scene.layers.length) continue;
    const score = layers.length * 100 + layers.reduce((a, l) => a + Math.min(l.w, 60), 0);
    if (!best || score > best.score) best = { scene, index, score };
  }
  if (!best) return undefined;
  const { scene, index } = best;
  return {
    slug: story.slug,
    name: story.name,
    chapter: `Chapter ${roman(index + 1)}`,
    year: scene.year,
    title: scene.title,
    plate: scene.plate!,
    background: scene.background!,
    layers: cuts(scene)
      .sort((a, b) => a.depth - b.depth)
      .map(({ src, concept, x, y, w, depth }) => ({ src, concept, x, y, w, depth })),
  };
}

/**
 * The scene the making section takes apart: one every stage has been run on, preferring a life
 * made on this site, whose job file records what each call actually cost.
 */
function showcase(stories: Story[]) {
  const ready = (sc: Scene) => sc.plate && sc.background && sc.video && cuts(sc).length && cuts(sc).length === sc.layers.length;
  const pick = (st: Story) => {
    const scored = st.scenes.map((scene, index) => ({ scene, index })).filter(({ scene }) => ready(scene));
    return scored.sort((a, b) => cuts(b.scene).length - cuts(a.scene).length)[0];
  };
  const order = [...stories.filter((st) => jobFor(st.slug)), ...stories];
  for (const story of order) {
    const p = pick(story);
    if (p) return { story, ...p, job: jobFor(story.slug) };
  }
}

export default function Home() {
  const stories = allStories();
  const first = stories[0];
  const hero = stories.map(heroScene).filter((h): h is HeroScene => Boolean(h));
  const demo = showcase(stories);
  const plates = stories.reduce((a, st) => a + st.scenes.filter((sc) => sc.plate).length, 0);
  const years = stories.flatMap((st) => st.scenes.map((sc) => Number(sc.year)));
  const made = stories
    .map((story) => ({ story, job: jobFor(story.slug) }))
    .filter((m): m is { story: Story; job: Job } => Boolean(m.job))
    .sort((a, b) => Date.parse(b.job.startedAt) - Date.parse(a.job.startedAt))[0];

  // Every name on the shelf is set on two lines (first word, then the rest) at one size: the
  // size the longest line allows. So names, and the dates under them, line up book to book.
  const longest = Math.max(8, ...stories.flatMap((st) => {
    const [a, ...b] = st.name.split(/\s+/);
    return [a.length, b.join(" ").length];
  }));
  const nameSize = `${Math.min(14, 74 / (longest * 0.46)).toFixed(2)}cqw`;

  // Costs for the making section: the job's own record where there is one, list price otherwise.
  const demoCuts = demo ? cuts(demo.scene) : [];
  const jobScene = demo?.job?.scenes.find((x) => x.id === demo.scene.id);
  const researchEach = demo?.job ? (demo.job.steps.research.usd + demo.job.steps.storyboard.usd) / demo.story.scenes.length : undefined;
  const samCost = jobScene?.spend.sam ?? demoCuts.length * PRICES.samImage;
  const pageCost = (researchEach ?? 0) + PRICES.image * 2 + samCost;

  return (
    <Reveal className={s.site}>
      {/* ---------- Hero: the desk where the books are made ---------- */}
      <div className={s.desk}>
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

        <section className={s.hero} aria-labelledby="hero-title">
          <div className={s.heroText}>
            <h1 id="hero-title" className={s.heroTitle}>
              <Masked text="Lives you read as illustrated books that move." />
            </h1>
            <p className={s.pitch}>
              Each book is a Singaporean life in seven chapters. Every fact is researched and cited, every chapter is painted in the print
              style of its decade, and each picture comes apart into layers that move as you scroll. All of it made with Meta’s models.
            </p>
            {first && (
              <div className={s.heroActions}>
                <Link href={`/${first.slug}`} className={s.primary}>
                  <span>Start reading</span>
                </Link>
                <Link href="/create" className={s.secondary}>
                  Make a new life
                </Link>
              </div>
            )}
            <p className={s.heroFacts}>
              {count(stories.length)} {stories.length === 1 ? "life" : "lives"} on the shelf, {plates} plates, {Math.min(...years)} to{" "}
              {Math.max(...years)}. Begins with {first?.name}.
            </p>
          </div>
          {hero.length > 0 && (
            <div className={s.heroArt}>
              <HeroPlate scenes={hero} />
            </div>
          )}
        </section>
      </div>

      <main>
        {/* ---------- The shelf ---------- */}
        <section id="shelf" className={s.shelfSection} aria-labelledby="shelf-title">
          <div className={s.sectionHead} data-reveal>
            <h2 id="shelf-title">
              <Masked text="On the shelf" />
            </h2>
            <p>
              {count(stories.length)} {stories.length === 1 ? "life" : "lives"} so far, each bound in the colours of the decade it starts
              in. Take one down to read it; each book runs on into the next.
            </p>
          </div>
          <ol className={s.shelf} style={{ "--name-size": nameSize } as CSSProperties} data-reveal>
            {stories.map((st, i) => {
              const era = eraFor(st.scenes[0].year);
              const span = `${st.scenes[0].year}–${st.scenes.at(-1)!.year}`;
              return (
                <li key={st.slug} className={s.slot} style={{ "--i": i } as CSSProperties}>
                  <div className={s.bookArea}>
                    <Link href={`/${st.slug}`} className={s.volumeLink} aria-label={`Open ${st.name}’s book`}>
                      <div className={s.volume} style={{ "--cloth": clothFor(era, i) } as CSSProperties}>
                        <span className={s.spine} aria-hidden>
                          <span className={s.spineNo}>{roman(i + 1)}</span>
                          <span className={s.spineName}>{st.name}</span>
                          <span className={s.spineDates}>{lifespan(st)}</span>
                        </span>
                        <Cover slug={st.slug} name={st.name} lifespan={lifespan(st)} part={`Part ${PART[i] ?? i + 1}`} className={s.front}>
                          {st.scenes[0].plate && (
                            <span className={s.onlay} aria-hidden>
                              <img src={st.scenes[0].plate} alt="" loading="lazy" />
                            </span>
                          )}
                        </Cover>
                      </div>
                    </Link>
                  </div>
                  <h3 className={s.labelName}>
                    <Link href={`/${st.slug}`}>{st.name}</Link>
                  </h3>
                  <p className={s.labelTag}>{st.tagline}</p>
                  <p className={s.labelMeta}>
                    {count(st.scenes.length)} chapters, {span}
                  </p>
                </li>
              );
            })}
            <li className={s.slot} style={{ "--i": stories.length } as CSSProperties}>
              <div className={s.bookArea}>
                <Link href="/create" className={s.volumeLink} aria-label="Make a new life">
                  <div className={`${s.volume} ${s.blank}`}>
                    <span className={s.spine} aria-hidden>
                      <span className={s.spineNo}>{roman(stories.length + 1)}</span>
                      <span className={s.spineName}>A new life</span>
                    </span>
                    <Cover slug="new" name="New life" lifespan="Name it" part="" lift={false} className={`${s.front} ${s.blankFront}`}>
                      <span className={`${s.onlay} ${s.onlayEmpty}`} aria-hidden>
                        <span>+</span>
                      </span>
                    </Cover>
                  </div>
                </Link>
              </div>
              <h3 className={s.labelName}>
                <Link href="/create">A new life</Link>
              </h3>
              <p className={s.labelTag}>Type a Singaporean’s name; the book is researched, painted and bound here.</p>
              <p className={s.labelMeta}>{made ? `About ${minutes(made.job)} minutes` : "Seven chapters"}</p>
            </li>
          </ol>
        </section>

        {/* ---------- How a page is made ---------- */}
        {demo && (
          <section id="making" className={s.making} aria-labelledby="making-title">
            <div className={s.sectionHead} data-reveal>
              <h2 id="making-title">
                <Masked text="How a page is made" />
              </h2>
              <p>
                One page from {demo.story.name}’s book, {demo.scene.year}: <i>{demo.scene.title}</i>. Each step below is the real file a Meta
                model returned, unretouched, with what the call cost.
              </p>
            </div>
            <ol className={s.stages} data-reveal>
              <li className={s.stage}>
                <p className={s.model}>
                  <b>Muse Spark</b> researches
                </p>
                <div className={`${s.frame} ${s.research}`}>
                  <p className={s.researchYear}>{demo.scene.year}</p>
                  <p className={s.researchText}>
                    {demo.scene.caption.split(/\s+/).map((w, k) => (
                      <span key={k} style={{ "--w": k } as CSSProperties}>
                        {w}{" "}
                      </span>
                    ))}
                  </p>
                  <ul className={s.sources}>
                    {demo.scene.sources.slice(0, 2).map((src) => (
                      <li key={src.url}>
                        <a href={src.url} target="_blank" rel="noopener noreferrer">
                          {src.label}
                        </a>
                      </li>
                    ))}
                    {demo.scene.sources.length > 2 && <li className={s.moreSources}>and {lower(demo.scene.sources.length - 2)} more</li>}
                  </ul>
                </div>
                <p className={s.cost}>{researchEach != null ? `${usd(researchEach)} a chapter` : "Priced per search"}</p>
                <p className={s.stageNote}>Searches the web, writes the dated timeline and cites it. A line without a source is dropped.</p>
              </li>
              <li className={s.stage}>
                <p className={s.model}>
                  <b>Muse Image</b> paints the plate
                </p>
                <div className={`${s.frame} ${s.wipe} ${s.wipeDown}`}>
                  <span>
                    <img src={demo.scene.plate} alt={`Plate: ${demo.scene.visual}`} loading="lazy" />
                  </span>
                </div>
                <p className={s.cost}>{usd(PRICES.image)}</p>
                <p className={s.stageNote}>From Muse Spark’s art direction, in the print style of the decade.</p>
              </li>
              <li className={s.stage}>
                <p className={s.model}>
                  <b>SAM 3.1</b> cuts it apart
                </p>
                <div className={`${s.frame} ${s.cutouts}`}>
                  <img className={s.cutPlate} src={demo.scene.plate} alt="" loading="lazy" />
                  {demoCuts.map((l, k) => (
                    <span
                      key={l.id}
                      className={s.cutPiece}
                      style={{ left: `${l.x - l.w / 2}%`, width: `${l.w}%`, bottom: `${100 - l.y}%`, "--k": k } as CSSProperties}
                    >
                      <img className={s.cutRing} src={l.src} alt="" aria-hidden loading="lazy" />
                      <img className={s.cutImg} src={l.src} alt={`Cut-out: ${l.concept}`} loading="lazy" />
                    </span>
                  ))}
                </div>
                <p className={s.cost}>
                  {usd(samCost)}
                  {demoCuts.length > 1 ? `, ${lower(demoCuts.length)} cuts` : ""}
                </p>
                <p className={s.stageNote}>
                  Finds “{demoCuts.map((l) => l.concept).join("” and “")}” in the plate and cuts {demoCuts.length > 1 ? "them" : "it"} out,
                  so each can move on its own.
                </p>
              </li>
              <li className={s.stage}>
                <p className={s.model}>
                  <b>Muse Image</b> clears the stage
                </p>
                <div className={`${s.frame} ${s.wipe} ${s.wipeAcross}`}>
                  <img className={s.under} src={demo.scene.plate} alt="" loading="lazy" />
                  <span>
                    <img src={demo.scene.background} alt="The plate with the cut-outs painted out" loading="lazy" />
                  </span>
                </div>
                <p className={s.cost}>{usd(PRICES.image)}</p>
                <p className={s.stageNote}>Edits the plate to paint out what SAM cut, leaving the empty set behind it.</p>
              </li>
              <li className={s.stage}>
                <p className={s.model}>
                  <b>The book</b> sets it moving
                </p>
                <div className={`${s.frame} ${s.film}`}>
                  <LoopFilm src={demo.scene.video!} poster={demo.scene.poster} label={`Scene film: ${demo.scene.visual}`} />
                </div>
                <p className={s.cost}>$0, made on our machine</p>
                <p className={s.stageNote}>No model here: each layer moves by its depth, in a film your scrolling plays.</p>
              </li>
            </ol>
            <div className={s.makingFoot} data-reveal>
              <blockquote className={s.direction}>
                <p>“{demo.scene.visual}”</p>
                <footer>The art direction Muse Spark wrote and Muse Image painted from.</footer>
              </blockquote>
              <div className={s.total}>
                <p className={s.totalSum}>{usd(pageCost)}</p>
                <p>
                  for this page in Meta API calls
                  {demo.job ? `; ${usd(demo.job.usd)} for the whole book, made in ${minutes(demo.job)} minutes.` : "."}
                </p>
                <Link href={`/${demo.story.slug}`} className={s.textLink}>
                  See it in Chapter {roman(demo.index + 1)} of {demo.story.name}’s book
                </Link>
              </div>
            </div>
          </section>
        )}

        {/* ---------- Make a new life ---------- */}
        <section id="make" className={s.make} aria-labelledby="make-title">
          <div className={s.makeText} data-reveal>
            <h2 id="make-title">
              <Masked text="Make a new life" />
            </h2>
            <p>
              Type a Singaporean’s name and watch the book being made: researched with cited sources, painted plate by plate, cut into
              layers, then bound and put on the shelf.
            </p>
            <ol className={s.makeSteps}>
              <li>
                <b>Research</b> Muse Spark finds and cites the life, decade by decade.
              </li>
              <li>
                <b>Plates</b> Muse Image paints seven scenes, each in its decade’s print style.
              </li>
              <li>
                <b>Layers</b> SAM 3.1 cuts out what should move.
              </li>
              <li>
                <b>Binding</b> The films are rendered and the book goes on the shelf.
              </li>
            </ol>
            <Link href="/create" className={s.makeCta}>
              <span>Start a book</span>
            </Link>
          </div>
          {made && (
            <figure className={s.proof} data-reveal>
              <ul className={s.proofPlates}>
                {made.story.scenes
                  .filter((sc) => sc.plate)
                  .map((sc, k) => (
                    <li key={sc.id} style={{ "--k": k } as CSSProperties}>
                      <img src={sc.plate} alt={`${sc.year}: ${sc.title}`} loading="lazy" />
                    </li>
                  ))}
              </ul>
              <figcaption>
                <Link href={`/${made.story.slug}`}>{made.story.name}</Link> was made here in {minutes(made.job)} minutes, for{" "}
                {usd(made.job.usd)} of Meta API calls. These are its {lower(made.story.scenes.length)} plates, as painted.
              </figcaption>
            </figure>
          )}
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
    </Reveal>
  );
}
