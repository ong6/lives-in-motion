/**
 * Directed films. Muse Wonder (pipeline/wonder.ts) looks at a scene's plate and its SAM 3.1
 * layers and writes a motion plan: a keyframed camera, a move per layer and one ambient effect.
 * The plan is stored at public/stories/<slug>/<sN>/motion.json and, when present, the film is
 * rendered from it instead of the fixed move. Everything a model writes passes through
 * sanitizePlan (types, ranges, known layer ids) and fitPlan (no layer pushed off-frame,
 * background always covers the frame). Pure.
 */
import { FILM, clamp01, easeInOutSine, easeOutCubic, lensForPath, lerp, project, type Camera, type Rect } from "./camera";

export const AMBIENTS = ["none", "light-sweep", "dust", "halftone-shimmer", "rain", "haze"] as const;
export const EASES = ["linear", "in-out", "in", "out"] as const;
export const ENTRANCES = ["none", "fade", "rise", "settle", "scale-in"] as const;
export type Ambient = (typeof AMBIENTS)[number];
export type Ease = (typeof EASES)[number];
export type Entrance = (typeof ENTRANCES)[number];

/** The ranges the renderer accepts; anything outside is clamped. */
export const LIMITS = {
  keys: { min: 2, max: 6 },
  /** Camera magnification of the nearest layer (distance 1); far layers grow less. */
  zoom: { min: 1, max: 1.5 },
  /** Camera travel each way, as a fraction of the frame at distance 1. */
  pan: 0.12,
  /** Point the camera zooms about. */
  focus: { min: 0.2, max: 0.8 },
  depth: { min: 0.3, max: 1 },
  /** A layer's own travel over the clip, frame fractions. */
  drift: 0.08,
  /** A layer's scale at the end of the clip, about its foot. */
  scale: { min: 0.85, max: 1.2 },
  enterAt: { min: 0, max: 0.6 },
  enterFor: { min: 0.1, max: 0.5 },
  /** Every entrance has finished by this clip time. */
  enterEnd: 0.8,
  /** Keyframes closer than this are merged. */
  keyGap: 0.05,
  /** A layer may lose at most this much more of its area off-frame than it shows at rest. */
  offFrame: 0.1,
  /** Most overscan the background may need; past it the plate softens visibly. */
  lens: 1.15,
};

export interface CameraKey {
  t: number;
  zoom: number;
  panX: number;
  panY: number;
  /** Easing of the segment arriving at this key (ignored on the first key). */
  ease: Ease;
}

export interface LayerMove {
  id: string;
  depth: number;
  driftX: number;
  driftY: number;
  scale: number;
  enter: Entrance;
  enterAt: number;
  enterFor: number;
}

export interface MotionPlan {
  focusX: number;
  focusY: number;
  camera: CameraKey[];
  layers: LayerMove[];
  ambient: Ambient;
  rationale: string;
}

const num = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : dflt;
  return Math.min(hi, Math.max(lo, n));
};
const pick = <T extends string>(v: unknown, all: readonly T[], dflt: T): T => (all.includes(v as T) ? (v as T) : dflt);

/** The fixed-move equivalent, used for anything a plan leaves out. */
export const defaultCamera = (): CameraKey[] => [
  { t: 0, zoom: 1, panX: -0.04, panY: 0, ease: "linear" },
  { t: 1, zoom: 1.2, panX: 0.04, panY: 0, ease: "in-out" },
];

/**
 * Coerce whatever a model returned into a plan the renderer can draw: numbers clamped to LIMITS,
 * unknown enums replaced, keyframes sorted with the first at t=0 and the last at t=1, layer moves
 * only for layers that exist (each exactly once, missing ones filled with a still default).
 * Returns the plan and a list of what was changed.
 */
export function sanitizePlan(raw: unknown, layers: { id: string; depth: number }[]): { plan: MotionPlan; fixes: string[] } {
  const fixes: string[] = [];
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const L = LIMITS;
  const clampNote = (name: string, v: unknown, out: number) => {
    if (typeof v !== "number" || Math.abs(v - out) > 1e-9) fixes.push(`${name} ${typeof v === "number" ? v.toFixed(3) : String(v)} → ${out.toFixed(3)}`);
    return out;
  };

  const rawKeys = (Array.isArray(r.camera) ? r.camera : []).filter((k: unknown) => k && typeof k === "object");
  // Models sometimes give key times in seconds (0, 1.75, 3.5) despite the schema: rescale those to 0..1.
  const tMax = Math.max(0, ...rawKeys.map((k: any) => (typeof k.t === "number" && Number.isFinite(k.t) ? k.t : 0)));
  const tScale = tMax > 1 && tMax <= 60 ? 1 / tMax : 1;
  if (tScale !== 1) fixes.push(`camera times rescaled from 0..${tMax} to 0..1`);
  let keys: CameraKey[] = rawKeys
    .map((k: any) => (typeof k.t === "number" ? { ...k, t: k.t * tScale } : k))
    .map((k: any, i: number) => ({
      t: clampNote(`camera[${i}].t`, k.t, num(k.t, 0, 1, 0)),
      zoom: clampNote(`camera[${i}].zoom`, k.zoom, num(k.zoom, L.zoom.min, L.zoom.max, 1)),
      panX: clampNote(`camera[${i}].panX`, k.panX, num(k.panX, -L.pan, L.pan, 0)),
      panY: clampNote(`camera[${i}].panY`, k.panY, num(k.panY, -L.pan, L.pan, 0)),
      ease: pick(k.ease, EASES, "in-out"),
    }))
    .sort((a: CameraKey, b: CameraKey) => a.t - b.t);
  const merged: CameraKey[] = [];
  for (const k of keys) {
    const last = merged[merged.length - 1];
    if (last && k.t - last.t < L.keyGap) {
      fixes.push(`camera key at t=${k.t.toFixed(2)} merged`);
      continue;
    }
    merged.push(k);
  }
  keys = merged;
  if (keys.length > L.keys.max) {
    fixes.push(`camera keys ${keys.length} → ${L.keys.max}`);
    keys = [...keys.slice(0, L.keys.max - 1), keys[keys.length - 1]];
  }
  if (keys.length < L.keys.min) {
    fixes.push("camera path missing: default move");
    keys = defaultCamera();
  }
  if (keys[0].t !== 0) (fixes.push("first camera key moved to t=0"), (keys[0] = { ...keys[0], t: 0 }));
  if (keys[keys.length - 1].t !== 1) (fixes.push("last camera key moved to t=1"), (keys[keys.length - 1] = { ...keys[keys.length - 1], t: 1 }));

  const given = new Map<string, any>();
  for (const m of Array.isArray(r.layers) ? r.layers : []) {
    if (!m || typeof m !== "object") continue;
    if (!layers.some((l) => l.id === m.id)) fixes.push(`unknown layer ${String(m.id)} dropped`);
    else if (given.has(m.id)) fixes.push(`duplicate layer ${m.id} dropped`);
    else given.set(m.id, m);
  }
  const moves: LayerMove[] = layers.map((l) => {
    const m = given.get(l.id);
    if (!m) {
      fixes.push(`layer ${l.id} missing: held still`);
      return { id: l.id, depth: num(l.depth, L.depth.min, L.depth.max, 0.6), driftX: 0, driftY: 0, scale: 1, enter: "none", enterAt: 0, enterFor: 0.3 };
    }
    const enter = pick(m.enter, ENTRANCES, "none");
    // Entrance timing only matters when there is an entrance; clamp it quietly otherwise.
    const note = enter === "none" ? (_: string, __: unknown, out: number) => out : clampNote;
    const enterAt = note(`${l.id}.enterAt`, m.enterAt, num(m.enterAt, L.enterAt.min, L.enterAt.max, 0));
    let enterFor = note(`${l.id}.enterFor`, m.enterFor, num(m.enterFor, L.enterFor.min, L.enterFor.max, 0.3));
    if (enterAt + enterFor > L.enterEnd) enterFor = note(`${l.id}.enterFor`, enterFor, Math.max(0.05, L.enterEnd - enterAt));
    return {
      id: l.id,
      depth: clampNote(`${l.id}.depth`, m.depth, num(m.depth, L.depth.min, L.depth.max, l.depth)),
      driftX: clampNote(`${l.id}.driftX`, m.driftX, num(m.driftX, -L.drift, L.drift, 0)),
      driftY: clampNote(`${l.id}.driftY`, m.driftY, num(m.driftY, -L.drift, L.drift, 0)),
      scale: clampNote(`${l.id}.scale`, m.scale, num(m.scale, L.scale.min, L.scale.max, 1)),
      enter,
      enterAt,
      enterFor,
    };
  });

  return {
    plan: {
      focusX: clampNote("focusX", r.focusX, num(r.focusX, L.focus.min, L.focus.max, 0.5)),
      focusY: clampNote("focusY", r.focusY, num(r.focusY, L.focus.min, L.focus.max, 0.5)),
      camera: keys,
      layers: moves,
      ambient: pick(r.ambient, AMBIENTS, "light-sweep"),
      rationale: typeof r.rationale === "string" ? r.rationale.slice(0, 400) : "",
    },
    fixes,
  };
}

const EASE_FN: Record<Ease, (t: number) => number> = {
  linear: clamp01,
  "in-out": easeInOutSine,
  in: (t) => clamp01(t) ** 2,
  out: easeOutCubic,
};

/** The camera of a plan at clip time t (0..1): keyframes interpolated with each segment's easing. */
export function planCamera(plan: MotionPlan, t: number): Camera {
  const keys = plan.camera;
  let k = 1;
  while (k < keys.length - 1 && keys[k].t < t) k++;
  const a = keys[k - 1], b = keys[k];
  const e = EASE_FN[b.ease]((t - a.t) / (b.t - a.t || 1));
  const zoom = lerp(a.zoom, b.zoom, e);
  return { z: 1 - 1 / zoom, x: lerp(a.panX, b.panX, e), y: lerp(a.panY, b.panY, e), settle: 0 };
}

/** A layer's own move at clip time t: opacity, offset and scale about its foot. */
export function layerAt(m: LayerMove, t: number, f = FILM) {
  const e = easeInOutSine(t);
  const u = easeOutCubic((t - m.enterAt) / m.enterFor);
  let scale = lerp(1, m.scale, e), dx = m.driftX * e, dy = m.driftY * e, opacity = 1;
  if (m.enter === "fade") opacity = u;
  else if (m.enter === "rise") (opacity = u), (dy += 0.03 * (1 - u));
  else if (m.enter === "settle") (dy += f.settleDrop * (1 - u)), (scale *= 1 - f.settleShrink * (1 - u));
  else if (m.enter === "scale-in") (opacity = u), (scale *= lerp(0.9, 1, u));
  return { opacity, dx, dy, scale };
}

/** Apply a layer move to a projected rectangle, scaling about `anchor`. */
export const moved = (r: Rect, anchor: { x: number; y: number }, la: { dx: number; dy: number; scale: number }): Rect => ({
  left: anchor.x + (r.left - anchor.x) * la.scale + la.dx,
  top: anchor.y + (r.top - anchor.y) * la.scale + la.dy,
  width: r.width * la.scale,
  height: r.height * la.scale,
});

/** Share (0..1) of a rectangle's area inside the frame. */
export function visibleShare(r: Rect): number {
  const w = Math.max(0, Math.min(1, r.left + r.width) - Math.max(0, r.left));
  const h = Math.max(0, Math.min(1, r.top + r.height) - Math.max(0, r.top));
  return r.width > 0 && r.height > 0 ? (w * h) / (r.width * r.height) : 0;
}

export const focusOf = (plan: MotionPlan) => ({ x: plan.focusX, y: plan.focusY });
export const pathOf = (plan: MotionPlan, steps = 40) => Array.from({ length: steps + 1 }, (_, i) => planCamera(plan, i / steps));

/** Where a layer's box lands on screen at clip time t. */
export function layerBox(plan: MotionPlan, m: LayerMove, box: Rect, t: number, lens: number, f = FILM): Rect {
  const p = project(box, m.depth, planCamera(plan, t), focusOf(plan), lens);
  return moved(p, { x: p.left + p.width / 2, y: p.top + p.height }, layerAt(m, t, f));
}

/** What breaks a plan: layers pushed off-frame, or a background needing too much overscan. */
export function planProblems(plan: MotionPlan, boxes: Record<string, Rect>, backDepth = 0, steps = 40): string[] {
  const out: string[] = [];
  const lens = lensForPath(backDepth, pathOf(plan, steps), focusOf(plan));
  if (lens > LIMITS.lens) out.push(`background needs ${lens.toFixed(3)} overscan`);
  for (const m of plan.layers) {
    const box = boxes[m.id];
    if (!box) continue;
    const rest = visibleShare(box);
    for (let i = 0; i <= steps; i++) {
      // A layer that hasn't made its entrance yet is invisible, so it can't clip the frame.
      if (layerAt(m, i / steps).opacity <= 0) continue;
      const v = visibleShare(layerBox(plan, m, box, i / steps, lens));
      if (v < rest - LIMITS.offFrame) {
        out.push(`${m.id} ${Math.round((1 - v) * 100)}% off-frame at t=${(i / steps).toFixed(2)}`);
        break;
      }
    }
  }
  return out;
}

/** Scale every excursion of a plan (zoom, pan, drift, end scale) toward rest by k. */
export function damp(plan: MotionPlan, k: number): MotionPlan {
  return {
    ...plan,
    camera: plan.camera.map((c) => ({ ...c, zoom: 1 + (c.zoom - 1) * k, panX: c.panX * k, panY: c.panY * k })),
    layers: plan.layers.map((m) => ({ ...m, driftX: m.driftX * k, driftY: m.driftY * k, scale: 1 + (m.scale - 1) * k })),
  };
}

/**
 * Make a sanitized plan safe to film: while any layer would leave the frame (or the background
 * would need too much overscan), damp the whole move; as a last resort hold everything still and
 * turn rises into fades, which never leave the frame.
 */
export function fitPlan(plan: MotionPlan, boxes: Record<string, Rect>, backDepth = 0): { plan: MotionPlan; fixes: string[] } {
  let p = plan;
  for (let i = 0; i < 8; i++) {
    const problems = planProblems(p, boxes, backDepth);
    if (!problems.length) return { plan: p, fixes: i ? [`move damped to ${Math.round(0.75 ** i * 100)}% (${planProblems(plan, boxes, backDepth).join("; ")})`] : [] };
    p = damp(plan, 0.75 ** (i + 1));
  }
  const still = damp(plan, 0);
  const safe = { ...still, focusX: 0.5, focusY: 0.5, layers: still.layers.map((m) => ({ ...m, enter: (m.enter === "rise" ? "fade" : m.enter) as Entrance })) };
  return { plan: safe, fixes: [`move could not be fitted (${planProblems(plan, boxes, backDepth).join("; ")}): held still`] };
}

/** A small deterministic PRNG, so a plan always renders the same film. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The square box (frame units) a schema layer occupies: x centre and y bottom in percent, height from the cut's aspect. */
export const layerRect = (l: { x: number; y: number; w: number }, aspect: number): Rect => {
  const w = l.w / 100, h = w * aspect;
  return { left: l.x / 100 - w / 2, top: l.y / 100 - h, width: w, height: h };
};
