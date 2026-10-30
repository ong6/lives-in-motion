import type { CSSProperties } from "react";
import d from "./Direction.module.css";

/** One camera keyframe of a Muse Wonder plan: zoom about the focus, then pan, as frame fractions. */
export interface CameraKey {
  t: number;
  zoom: number;
  panX: number;
  panY: number;
}

/** What Muse Wonder did for one scene's film (read on the server by components/direction.server.ts). */
export interface Direction {
  /** Its critic rejected every round, so the film kept the renderer's fixed move. */
  kept: boolean;
  model: string;
  at?: string;
  usd: number;
  rationale: string;
  focus: { x: number; y: number };
  camera: CameraKey[];
  ambient: string;
  /** The critic's score out of 10 for the chosen round, and its verdict on the six frames. */
  score: number;
  verdict: string;
  /** Plans tried (the first and each revision), and which one was kept (1-based; 0 if none). */
  rounds: number;
  best: number;
  /** Faults the critic found in the plate itself. */
  defects: string[];
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six"];
const word = (n: number) => WORDS[n] ?? String(n);
const date = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Singapore" }) : "";

/**
 * The first sentence or two of a note, at most about `max` characters. Sentences end at . ! or ?
 * followed by a space and a capital (so "0.88" or "t=0." inside a sentence don't split it); a
 * first sentence too short to say much is followed by as much of the next as fits.
 */
function gist(text: string, max = 230): string {
  const sentences = text.trim().split(/(?<=[.!?])\s+(?=[A-Z“"(])/);
  let out = "";
  for (const s of sentences) {
    if (!out || (out + " " + s).length <= max) out = out ? `${out} ${s}` : s;
    else {
      if (out.length < 60) out += ` ${s.slice(0, max - out.length).replace(/[\s,;:]+\S*$/, "")}…`;
      break;
    }
  }
  return out.length > max + 40 ? `${out.slice(0, max).replace(/\s+\S*$/, "")}…` : out;
}

/** The frame the camera sees at a keyframe, in the plate's 0..100 units. */
function frameAt(k: CameraKey, focus: { x: number; y: number }) {
  const w = 1 / Math.max(1, k.zoom);
  const x = focus.x * (1 - w) + k.panX;
  const y = focus.y * (1 - w) + k.panY;
  return { x: x * 100, y: y * 100, w: w * 100, cx: (x + w / 2) * 100, cy: (y + w / 2) * 100 };
}

/**
 * The camera move drawn over the plate: each keyframe's frame (the first dashed, the last
 * solid with viewfinder corners), the dotted path its corners and centre travel, a dot per
 * keyframe, and a viewfinder that plays the move on a loop.
 */
export function CameraPath({ plate, dir }: { plate: string; dir: Direction }) {
  const frames = dir.camera.map((k) => frameAt(k, dir.focus));
  const first = frames[0];
  const last = frames.at(-1)!;
  const corner = (f: (typeof frames)[number], i: number) => [f.x + (i % 2) * f.w, f.y + Math.floor(i / 2) * f.w];
  const tick = (f: (typeof frames)[number]) => {
    const l = Math.min(7, f.w * 0.16);
    const [x0, y0, x1, y1] = [f.x, f.y, f.x + f.w, f.y + f.w];
    return `M${x0} ${y0 + l}V${y0}H${x0 + l}M${x1 - l} ${y0}H${x1}V${y0 + l}M${x1} ${y1 - l}V${y1}H${x1 - l}M${x0 + l} ${y1}H${x0}V${y1 - l}`;
  };
  const maskId = `outside-${plate.replace(/\W+/g, "-")}`;
  const splines = dir.camera.slice(1).map(() => "0.45 0 0.55 1").join(";");
  const keyTimes = dir.camera.map((k) => k.t.toFixed(3)).join(";");
  const vals = (pick: (f: (typeof frames)[number]) => number) => frames.map((f) => pick(f).toFixed(2)).join(";");
  return (
    <div className={d.thumb}>
      <img src={plate} alt="" />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <defs>
          <mask id={maskId}>
            <rect width="100" height="100" fill="#fff" />
            <rect x={last.x} y={last.y} width={last.w} height={last.w} fill="#000" />
          </mask>
        </defs>
        {/* What the film never shows by its end, dimmed. */}
        <rect width="100" height="100" className={d.outside} mask={`url(#${maskId})`} />
        {[0, 1, 2, 3].map((i) => (
          <polyline key={i} className={d.trail} points={frames.map((f) => corner(f, i).join(",")).join(" ")} />
        ))}
        <rect className={d.firstFrame} x={first.x} y={first.y} width={first.w} height={first.w} />
        {frames.slice(1, -1).map((f, i) => (
          <rect key={i} className={d.midFrame} x={f.x} y={f.y} width={f.w} height={f.w} />
        ))}
        <path className={d.lastFrame} d={tick(last)} />
        <polyline className={d.path} points={frames.map((f) => `${f.cx},${f.cy}`).join(" ")} />
        {frames.map((f, i) => (
          <circle key={i} className={d.key} cx={f.cx} cy={f.cy} r={i === frames.length - 1 ? 1.9 : 1.5} />
        ))}
        <rect className={d.finder} x={first.x} y={first.y} width={first.w} height={first.w}>
          <animate attributeName="x" values={vals((f) => f.x)} keyTimes={keyTimes} dur="4s" repeatCount="indefinite" calcMode="spline" keySplines={splines} />
          <animate attributeName="y" values={vals((f) => f.y)} keyTimes={keyTimes} dur="4s" repeatCount="indefinite" calcMode="spline" keySplines={splines} />
          <animate attributeName="width" values={vals((f) => f.w)} keyTimes={keyTimes} dur="4s" repeatCount="indefinite" calcMode="spline" keySplines={splines} />
          <animate attributeName="height" values={vals((f) => f.w)} keyTimes={keyTimes} dur="4s" repeatCount="indefinite" calcMode="spline" keySplines={splines} />
        </rect>
      </svg>
    </div>
  );
}

/**
 * The director's card shown with a plate taken apart: why Muse Wonder moved the camera and the
 * layers as it did, the move drawn over the plate, and what its critic said of the film.
 */
export function DirectionCard({ dir, plate, style }: { dir: Direction; plate: string; style?: CSSProperties }) {
  const revisions = dir.rounds - 1;
  const outcome = dir.kept
    ? `Not passed in ${word(dir.rounds)} rounds, so the film keeps the standard push-in.`
    : dir.rounds === 1
      ? "Passed on the first plan."
      : `Passed on round ${word(dir.best)} of ${word(dir.rounds)}, after ${word(revisions)} revision${revisions === 1 ? "" : "s"}.`;
  return (
    <aside className={d.card} style={style} aria-label="How Muse Wonder directed this film">
      <p className={d.kicker}>{dir.kept ? "Reviewed by Muse Wonder" : "Directed by Muse Wonder"}</p>
      <div className={d.top}>
        <CameraPath plate={plate} dir={dir} />
        <div className={d.score}>
          <p className={d.big}>
            {dir.score}
            <span>/10</span>
          </p>
          <p className={d.scoreLabel}>the critic’s score</p>
          <ol className={d.rounds} aria-label={`${dir.rounds} round${dir.rounds === 1 ? "" : "s"}`}>
            {Array.from({ length: dir.rounds }, (_, i) => (
              <li key={i} data-best={i + 1 === dir.best || undefined} />
            ))}
          </ol>
          <p className={d.outcome}>{outcome}</p>
        </div>
      </div>
      <p className={d.label}>Its direction</p>
      <p className={d.rationale}>{gist(dir.rationale, 240)}</p>
      <p className={d.label}>Its critique, from six frames of the render</p>
      <p className={d.verdict}>{gist(dir.verdict, 170)}</p>
      {dir.defects.length > 0 && <p className={d.defect}>It also flagged the plate: {[...new Set(dir.defects)].join(", ").replace(/-/g, " ")}.</p>}
      <p className={d.meta}>
        {dir.model} · ${dir.usd.toFixed(2)} · {date(dir.at)}
      </p>
    </aside>
  );
}
