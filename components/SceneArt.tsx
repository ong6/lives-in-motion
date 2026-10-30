import type { CSSProperties } from "react";
import type { Layer, Scene } from "@/lib/schema";
import { Overlay } from "./Overlay";
import { LineDrawing } from "./LineDrawing";
import s from "./SceneArt.module.css";

const place = (l: Layer): CSSProperties => ({
  left: `${l.x}%`,
  top: `${l.y}%`,
  width: `${l.w}%`,
  zIndex: Math.round(l.depth * 100),
  ["--depth" as string]: l.depth,
});

function Layers({ layers }: { layers: Layer[] }) {
  return layers.map((l) => (
    <div key={l.id} className={s.layer} style={place(l)} data-concept={l.concept}>
      {l.src ? <img src={l.src} alt="" /> : <Overlay kind={l.overlay!} text={l.text} />}
    </div>
  ));
}

/**
 * One scene's art. The treatment decides how the picture is presented; everything is driven
 * by --p, the scene's own scroll progress (0 entering, 0.5 centred, 1 leaving).
 */
export function SceneArt({ scene, progress, active }: { scene: Scene; progress: number; active: boolean }) {
  const style = { ["--p" as string]: progress } as CSSProperties;
  const cls = `${s.art} ${s[scene.treatment]} ${active ? s.active : ""}`;

  if (!scene.plate) {
    // No illustration yet: a clean typographic panel, never placeholder clip-art.
    return (
      <div className={`${s.art} ${s.pending} ${active ? s.active : ""}`} style={style} aria-hidden>
        <span className={s.ghostYear}>{scene.year}</span>
        <div className={s.box}>
          <Layers layers={scene.layers.filter((l) => l.overlay)} />
        </div>
      </div>
    );
  }

  if (scene.treatment === "line" && scene.line) {
    return (
      <div className={cls} style={style}>
        <img className={s.lineUnder} src={scene.background ?? scene.plate} alt="" />
        <LineDrawing className={s.lineCanvas} src={scene.line} progress={Math.min(1, progress / 0.7)} label={scene.visual} />
      </div>
    );
  }

  if (scene.treatment === "archive") {
    return (
      <div className={cls} style={style}>
        <figure className={s.plateFrame}>
          <div className={s.box}>
            <img className={s.plate} src={scene.plate} alt={scene.visual} />
            <Layers layers={scene.layers.filter((l) => l.overlay)} />
          </div>
          <figcaption>
            Pl. {scene.id.slice(1)} · {scene.year}
          </figcaption>
        </figure>
      </div>
    );
  }

  return (
    <div className={cls} style={style}>
      <div className={s.box}>
        <img className={s.background} src={scene.background ?? scene.plate} alt={scene.visual} />
        <Layers layers={scene.layers} />
      </div>
    </div>
  );
}
