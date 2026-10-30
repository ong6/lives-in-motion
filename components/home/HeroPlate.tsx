"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import s from "./HeroPlate.module.css";

export interface HeroLayer {
  src: string;
  concept: string;
  /** Placement in the square art box, as in the story file: x centre, y bottom edge, w width, all percent. */
  x: number;
  y: number;
  w: number;
  depth: number;
}

export interface HeroScene {
  slug: string;
  name: string;
  /** "Chapter II" */
  chapter: string;
  year: string;
  title: string;
  plate: string;
  background: string;
  layers: HeroLayer[];
}

/** One turn: the whole plate, then it comes apart, holds, closes up, and the next life's plate follows. */
const APART_AT = 1100;
const CLOSE_AT = 5600;
const NEXT_AT = 7000;

/**
 * The hero picture: one real plate from each life on the shelf, taken apart into the layers it
 * was made from. The Muse Image background stays on the board; each SAM 3.1 cut-out lifts off
 * it by its depth, labelled with what it was cut by. Pointing at it holds it open and tilts it
 * a little with the pointer; it pauses off screen, and stands still, open, for reduced motion.
 */
export function HeroPlate({ scenes }: { scenes: HeroScene[] }) {
  const [index, setIndex] = useState(0);
  const [apart, setApart] = useState(false);
  const [held, setHeld] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [visible, setVisible] = useState(true);
  const [still, setStill] = useState(false);
  const figure = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  useEffect(() => setStill(matchMedia("(prefers-reduced-motion: reduce)").matches), []);

  // Off screen or in a background tab, nothing runs.
  useEffect(() => {
    const el = figure.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting && !document.hidden), { threshold: 0.05 });
    const onVis = () => setVisible(!document.hidden && el.getBoundingClientRect().bottom > 0);
    io.observe(el);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const running = !still && !held && !stopped && visible && scenes.length > 0;

  useEffect(() => {
    if (still || held) {
      setApart(true);
      return;
    }
    if (!running) return;
    setApart(false);
    const timers = [
      setTimeout(() => setApart(true), APART_AT),
      setTimeout(() => setApart(false), CLOSE_AT),
      setTimeout(() => setIndex((i) => (i + 1) % scenes.length), NEXT_AT),
    ];
    return () => timers.forEach(clearTimeout);
  }, [index, running, still, held, scenes.length]);

  const tilt = (e: React.PointerEvent) => {
    if (still || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 2 - 1;
    const py = ((e.clientY - r.top) / r.height) * 2 - 1;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      stage.current?.style.setProperty("--px", px.toFixed(3));
      stage.current?.style.setProperty("--py", py.toFixed(3));
    });
  };
  const untilt = () => {
    cancelAnimationFrame(frame.current);
    stage.current?.style.setProperty("--px", "0");
    stage.current?.style.setProperty("--py", "0");
  };

  const active = scenes[index];
  if (!active) return null;

  return (
    <figure ref={figure} className={s.figure} data-still={still || undefined}>
      <div
        className={s.viewport}
        onPointerMove={tilt}
        onPointerEnter={(e) => e.pointerType === "mouse" && setHeld(true)}
        onPointerLeave={() => {
          setHeld(false);
          untilt();
        }}
        role="img"
        aria-label={`${active.chapter} of ${active.name}’s book, ${active.year}: the plate taken apart into the background Muse Image painted and the cut-outs SAM 3.1 made of ${active.layers
          .map((l) => l.concept)
          .join(" and ")}.`}
      >
        <div ref={stage} className={s.stage}>
          {scenes.map((sc, i) => (
            <div key={sc.slug} className={s.plate} data-active={i === index || undefined} data-apart={(i === index && apart) || undefined}>
              <img className={s.back} src={sc.background} alt="" fetchPriority={i === 0 ? "high" : "low"} />
              <img className={s.whole} src={sc.plate} alt="" fetchPriority={i === 0 ? "high" : "low"} />
              <span className={`${s.tag} ${s.tagBack}`}>
                Background <i>Muse Image</i>
              </span>
              {sc.layers.map((l, k) => (
                <div
                  key={l.src}
                  className={s.cut}
                  style={
                    {
                      left: `${l.x - l.w / 2}%`,
                      width: `${l.w}%`,
                      bottom: `${100 - l.y}%`,
                      "--z": `${90 + l.depth * 190}px`,
                      "--k": k,
                    } as CSSProperties
                  }
                >
                  <img src={l.src} alt="" />
                  <span className={s.tag}>
                    {l.concept} <i>SAM 3.1</i>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <figcaption className={s.caption}>
        <p className={s.now} aria-live="polite">
          <Link href={`/${active.slug}`}>{active.name}</Link>, {active.year}: <i>{active.title}</i>
        </p>
        <div className={s.controls}>
          <ul className={s.lives} aria-label="Show a plate from">
            {scenes.map((sc, i) => (
              <li key={sc.slug}>
                <button
                  type="button"
                  aria-pressed={i === index}
                  onClick={() => {
                    setIndex(i);
                    setApart(false);
                  }}
                >
                  {sc.name}
                  {i === index && (
                    <span
                      key={`${index}-${running}`}
                      className={s.progress}
                      data-running={running || undefined}
                      style={{ "--t": `${NEXT_AT}ms` } as CSSProperties}
                      aria-hidden
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>
          {!still && scenes.length > 1 && (
            <button type="button" className={s.pause} onClick={() => setStopped((v) => !v)} aria-pressed={stopped}>
              {stopped ? "Play" : "Pause"}
            </button>
          )}
        </div>
      </figcaption>
    </figure>
  );
}
