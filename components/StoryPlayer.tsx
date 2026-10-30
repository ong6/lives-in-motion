"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import type { Story } from "@/lib/schema";
import { eraFor, eraVars } from "@/lib/eras";
import { LineDrawing } from "./LineDrawing";
import { SceneArt } from "./SceneArt";
import { useScrollProgress } from "./useScrollProgress";
import s from "./StoryPlayer.module.css";

/** Screen heights of scroll per scene; more gives each scene longer to breathe. */
const PER_SCENE = 1.6;

function useYearCounter(target: number) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / 650);
      const eased = 1 - (1 - k) ** 3;
      setShown(Math.round(a + (target - a) * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

export function StoryPlayer({ story, lifespan, portrait, credit }: { story: Story; lifespan: string; portrait: string; credit: string }) {
  const intro = useRef<HTMLElement>(null);
  const track = useRef<HTMLElement>(null);
  const introP = useScrollProgress(intro);
  const trackP = useScrollProgress(track);
  const n = story.scenes.length;
  const pos = trackP * n;
  const index = Math.min(n - 1, Math.floor(pos));
  const scene = story.scenes[index];
  const era = eraFor(scene.year);
  const year = useYearCounter(Number(scene.year));
  const vars = useMemo(() => eraVars(trackP > 0 ? era : eraFor(story.scenes[0].year)) as CSSProperties, [era, trackP, story.scenes]);

  const jump = (i: number) => {
    const el = track.current;
    if (!el) return;
    const top = el.offsetTop + ((i + 0.45) / n) * (el.offsetHeight - innerHeight);
    scrollTo({ top, behavior: "smooth" });
  };

  return (
    <main className={s.story} style={vars}>
      <header className={s.bar}>
        <Link href="/">Lives in Motion</Link>
        <span>{story.name}</span>
      </header>

      <section ref={intro} className={s.intro}>
        <div className={s.introStage}>
          <div className={s.introText}>
            <p className={s.kicker}>A life in {n} scenes</p>
            <h1 className={s.name}>{story.name}</h1>
            <p className={s.dates}>{lifespan}</p>
            <p className={s.tagline}>{story.tagline}</p>
            <p className={s.cue} style={{ opacity: 1 - introP * 2 }}>
              Scroll to draw him
            </p>
          </div>
          <figure className={s.portrait}>
            <LineDrawing src={portrait} progress={Math.min(1, introP * 1.15)} label={`${story.name}, drawn in pen strokes`} />
            <figcaption>{credit}</figcaption>
          </figure>
        </div>
      </section>

      <section ref={track} className={s.track} style={{ height: `${n * PER_SCENE * 100}svh` }}>
        <div className={s.stage}>
          <div className={s.text}>
            <p className={s.meta}>
              <span>
                {String(index + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}
              </span>
              <span>{era.label}</span>
            </p>
            <p className={s.year} aria-hidden>
              {year}
            </p>
            {story.scenes.map((sc, i) => (
              <div key={sc.id} className={`${s.caption} ${i === index ? s.on : ""}`} aria-hidden={i !== index}>
                <h2 className={s.title}>
                  <span className={s.srOnly}>{sc.year}: </span>
                  {sc.title}
                </h2>
                <p className={s.body}>{sc.caption}</p>
              </div>
            ))}
          </div>

          <div className={s.art}>
            {story.scenes.map((sc, i) =>
              Math.abs(i - index) <= 1 ? (
                <SceneArt key={sc.id} scene={sc} active={i === index} progress={Math.min(1, Math.max(0, pos - i))} />
              ) : null,
            )}
          </div>

          <nav className={s.rail} aria-label="Timeline">
            {story.scenes.map((sc, i) => (
              <button key={sc.id} className={i === index ? s.on : ""} onClick={() => jump(i)} aria-current={i === index ? "step" : undefined}>
                <span className={s.railYear}>{sc.year}</span>
                <span className={s.railTitle}>{sc.title}</span>
              </button>
            ))}
          </nav>
        </div>
      </section>

      <footer className={s.foot}>
        <h2>Sources</h2>
        <ol>
          {story.scenes.map((sc) => (
            <li key={sc.id}>
              <span className={s.footYear}>{sc.year}</span>
              <span>
                {sc.title}:{" "}
                {sc.sources.map((src, k) => (
                  <span key={src.url}>
                    {k > 0 && ", "}
                    <a href={src.url} target="_blank" rel="noopener noreferrer">
                      {src.label}
                    </a>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ol>
        <p className={s.note}>
          Scenes illustrated with Meta Muse Image and cut into layers with SAM 3.1. People appear as silhouettes; the portrait is
          traced from a credited photograph. {credit}
        </p>
        <Link href="/" className={s.back}>
          ← All lives
        </Link>
      </footer>
    </main>
  );
}
