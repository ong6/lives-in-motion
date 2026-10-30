import Link from "next/link";
import type { CSSProperties } from "react";
import { allStories, lifespan } from "@/lib/stories";
import { portraitCredit, portraitSrc } from "@/lib/portraits";
import { LineDrawing } from "@/components/LineDrawing";
import { Endpaper, Page, Spread } from "@/components/book/Page";
import { Contents, type ContentsEntry } from "@/components/book/Contents";
import { PART, firstPages } from "@/components/book/pagination";
import s from "./home.module.css";

const NICKNAME: Record<string, string> = { "jack-sim": "Mr. Toilet" };

export default function Home() {
  const stories = allStories();
  const first = stories[0];
  const pages = firstPages(stories.map((st) => st.scenes.length));
  const entries: ContentsEntry[] = stories.map((st, i) => ({
    slug: st.slug,
    part: PART[i] ?? String(i + 1),
    name: st.name,
    nickname: NICKNAME[st.slug],
    lifespan: lifespan(st),
    tagline: st.tagline,
    // The title page, one after the frontispiece.
    page: pages[i] + 1,
    portrait: portraitSrc(st.slug),
    credit: portraitCredit(st.slug),
  }));
  const allYears = [...new Set(stories.flatMap((st) => st.scenes.map((sc) => sc.year)))].sort();

  return (
    <main className={s.home} data-desk>
      <section className={s.leaf}>
        <Spread
          read={0.04}
          verso={
            <Page side="verso" placed>
              <figure className={s.frontis}>
                <div className={s.frontisArt}>
                  <LineDrawing src={portraitSrc(first.slug)} loop label={`${first.name}, drawing himself in pen strokes`} />
                </div>
                <figcaption>
                  <i>{first.name}</i>, drawn stroke by stroke the way a pen plotter would. SAM 3.1 cut him out of the photograph,
                  which develops under the lines as the drawing finishes. {portraitCredit(first.slug)}
                </figcaption>
              </figure>
            </Page>
          }
          recto={
            <Page side="recto" placed>
              <div className={s.titlePage}>
                <h1 className={s.bookTitle}>Lives in Motion</h1>
                <p className={s.subtitle}>Three Singaporean lives, drawn stroke by stroke</p>
                <span className={s.rule} aria-hidden />
                <p className={s.lede}>
                  Read a life decade by decade: what happened, when, and why it mattered. Every scene is sourced, and every picture
                  is made with Meta’s AI.
                </p>
                <Link href={`/${first.slug}`} className={s.begin}>
                  Begin with {NICKNAME[first.slug] ?? first.name}
                </Link>
                <p className={s.beginMeta}>
                  Part One, page {pages[0] + 1}. {first.scenes.length} chapters, about three minutes.
                </p>
                <p className={s.imprint}>
                  <span>Lives in Motion</span>
                  Singapore, 2026
                </p>
              </div>
            </Page>
          }
        />
      </section>

      <section id="contents" className={s.leaf}>
        <Spread
          read={0.12}
          verso={null}
          recto={
            <Contents
              entries={entries}
              folios={["iv", "v"]}
              back={[
                { label: "How a life is made", href: "#making", page: "vii" },
                { label: "Colophon", href: "#colophon", page: "viii" },
              ]}
            />
          }
        />
      </section>

      <section id="making" className={s.leaf}>
        <Spread
          read={0.2}
          verso={
            <Page side="verso" placed head="Lives in Motion" folio="vi">
              <blockquote className={s.epigraph}>
                <p>
                  A biography is considered complete if it merely accounts for six or seven selves, whereas a person may well have
                  as many thousand.
                </p>
                <footer>
                  Virginia Woolf, <cite>Orlando</cite> (1928)
                </footer>
              </blockquote>
            </Page>
          }
          recto={
            <Page side="recto" placed head="A note on the making" folio="vii">
              <div className={s.making}>
                <h2 className={s.pageTitle}>How a life is made</h2>
                <p className={s.makingLede}>
                  Built for the Meta Global AI Developer Hackathon (2026). Four steps, each done by a Meta model or by maths, and
                  checked by a person.
                </p>
                <ol className={s.steps}>
                  <li>
                    <b>Research.</b> Muse Spark searches the web and writes a dated timeline. A line without a citation is dropped.
                    <i>Muse Spark with web search</i>
                  </li>
                  <li>
                    <b>Illustrate.</b> Muse Image paints each scene in its decade’s print style, from 1920s engraving to 1990s
                    risograph.
                    <i>Muse Image</i>
                  </li>
                  <li>
                    <b>Cut.</b> SAM 3.1 finds the objects in each painting and cuts them out, so they can move on their own as you
                    scroll.
                    <i>SAM 3.1</i>
                  </li>
                  <li>
                    <b>Draw.</b> Each portrait is traced into pen strokes and drawn back one stroke at a time, then the photograph
                    develops underneath.
                    <i>linedraw and vivus</i>
                  </li>
                </ol>
              </div>
            </Page>
          }
        />
      </section>

      <section id="colophon" className={s.leaf}>
        <Spread
          read={1}
          verso={
            <Page side="verso" placed style={{ ["--accent2" as string]: "#4f6b5a", ["--accent" as string]: "#9a3c1c" } as CSSProperties}>
              <Endpaper years={allYears} />
            </Page>
          }
          recto={
            <Page side="recto" placed folio="viii">
              <div className={s.colophon}>
                <h2>Colophon</h2>
                <p>
                  <i>Lives in Motion</i> was made for the Meta Global AI Developer Hackathon, October and November 2026.
                </p>
                <p>
                  Research by Muse Spark with web search; plates by Muse Image; cut-outs by SAM 3.1. Portraits are traced from openly
                  licensed photographs with linedraw and drawn with vivus; scene figures are silhouettes by design.
                </p>
                <p>Facts link to their sources in the notes at the end of each life.</p>
                <p>Set in Instrument Serif and Newsreader.</p>
                <span className={s.rule} aria-hidden />
                <Link href={`/${first.slug}`} className={s.colophonLink}>
                  Begin reading
                </Link>
              </div>
            </Page>
          }
        />
      </section>
    </main>
  );
}
