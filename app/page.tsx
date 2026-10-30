import Link from "next/link";
import { allStories, lifespan } from "@/lib/stories";
import { eraFor, ERAS } from "@/lib/eras";
import { portraitCredit, portraitSrc } from "@/lib/portraits";
import { LineDrawing } from "@/components/LineDrawing";
import s from "./home.module.css";

const NICKNAME: Record<string, string> = { "jack-sim": "Mr. Toilet" };

/** The eras a life passes through: a thin proportional rule, then the eras named in order. */
function EraBand({ from, to }: { from: number; to: number }) {
  const span = to - from || 1;
  const bands = ERAS.filter((e) => e.to >= from && e.from <= to).map((e) => ({
    e,
    w: ((Math.min(e.to, to) - Math.max(e.from, from) + 1) / span) * 100,
  }));
  return (
    <div className={s.band}>
      <div className={s.rule} aria-hidden>
        {bands.map(({ e, w }) => (
          <span key={e.id} style={{ flexGrow: w, background: e.accent }} />
        ))}
      </div>
      <ul className={s.eras} aria-label="Eras this life spans">
        {bands.map(({ e }) => (
          <li key={e.id} style={{ ["--dot" as string]: e.accent }}>
            {e.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Home() {
  const stories = allStories();
  const first = stories[0];
  return (
    <main className={s.home}>
      <header className={s.bar}>
        <span className={s.mark}>Lives in Motion</span>
        <nav>
          <a href="#lives">The lives</a>
          <a href="#how">How it’s made</a>
        </nav>
      </header>

      <section className={s.hero}>
        <div className={s.heroText}>
          <p className={s.kicker}>Singapore · 1923 to today</p>
          <h1 className={s.h1}>
            Three Singaporean lives, <em>drawn stroke by stroke.</em>
          </h1>
          <p className={s.lede}>
            Scroll through a life decade by decade: what happened, when, and why it mattered. Every scene is sourced, and every
            picture is made with Meta’s AI.
          </p>
          <div className={s.cta}>
            <Link href={`/${first.slug}`} className={s.primary}>
              Begin with {NICKNAME[first.slug] ?? first.name} <span aria-hidden>→</span>
            </Link>
            <span className={s.ctaMeta}>
              {first.scenes.length} scenes · about 3 minutes
            </span>
          </div>
        </div>
        <figure className={s.heroArt}>
          <LineDrawing src={portraitSrc(first.slug)} loop label={`${first.name}, drawing himself in pen strokes`} />
          <figcaption>
            <b>{first.name}</b>, drawn stroke by stroke, the way a pen plotter would, after SAM 3.1 cut him out of the photo. {portraitCredit(first.slug)}
          </figcaption>
        </figure>
      </section>

      <section id="lives" className={s.lives}>
        <h2 className={s.h2}>The lives</h2>
        <ol className={s.list}>
          {stories.map((story, i) => {
            const start = eraFor(story.scenes[0].year);
            const lastYear = Number(story.scenes[story.scenes.length - 1].year);
            return (
              <li key={story.slug} style={{ ["--hover" as string]: start.paper, ["--accent" as string]: start.accent }}>
                <Link href={`/${story.slug}`} className={s.row}>
                  <span className={s.no}>{String(i + 1).padStart(2, "0")}</span>
                  <div className={s.rowArt}>
                    <LineDrawing src={portraitSrc(story.slug)} progress={1} label={`${story.name}, line portrait`} />
                  </div>
                  <div className={s.rowText}>
                    <h3>
                      {story.name}
                      {NICKNAME[story.slug] && <em> “{NICKNAME[story.slug]}”</em>}
                    </h3>
                    <p className={s.rowDates}>{lifespan(story)}</p>
                    <p className={s.rowTag}>{story.tagline}</p>
                    <EraBand from={Number(story.scenes[0].year)} to={lastYear} />
                  </div>
                  <span className={s.go}>
                    Watch his life <span aria-hidden>→</span>
                    <small>{story.scenes.length} scenes</small>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      <section id="how" className={s.how}>
        <h2 className={s.h2}>How a life is made</h2>
        <p className={s.howLede}>
          Built for the Meta Global AI Developer Hackathon (2026). Four steps, each done by a Meta model or by maths, and checked
          by a person.
        </p>
        <ol className={s.steps}>
          <li>
            <b>Research</b>
            <span>Muse Spark searches the web and writes a dated timeline. A line without a citation is dropped.</span>
            <i>Muse Spark · web search</i>
          </li>
          <li>
            <b>Illustrate</b>
            <span>Muse Image paints each scene in its decade’s print style, from 1920s engraving to 1990s risograph.</span>
            <i>Muse Image</i>
          </li>
          <li>
            <b>Cut</b>
            <span>SAM 3.1 finds the objects in each painting and cuts them out, so they can move on their own as you scroll.</span>
            <i>SAM 3.1</i>
          </li>
          <li>
            <b>Draw</b>
            <span>Contours become one continuous line, rebuilt from 1,500 turning circles, so the picture draws itself.</span>
            <i>Fourier series</i>
          </li>
        </ol>
      </section>

      <footer className={s.foot}>
        <p>
          Lives in Motion. Facts link to their sources on every story page. Portraits are traced from openly licensed photographs;
          scene figures are silhouettes by design.
        </p>
      </footer>
    </main>
  );
}
