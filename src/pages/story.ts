import { boot } from "./common";
import { bySlug } from "../stories";
import { renderStory } from "../render/story";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { DIRECTIONS } from "../render/frame";
import type { Direction } from "../schema";

const app = boot();
const q = new URLSearchParams(location.search);
const story = bySlug(q.get("p"));
const d = q.get("d") as Direction | null;
const direction = DIRECTIONS.some((x) => x.id === d) ? d! : story.direction;
document.title = `${story.name} · Lives in Motion`;
const player = renderStory(app, story, direction);
// Deep link to a scene (?s=4), handy for demos and screenshots.
const at = Number(q.get("s"));
document.fonts.ready.then(() => {
  ScrollTrigger.refresh();
  if (at >= 1 && at <= story.scenes.length) player.goTo(at - 1, "instant");
  if (q.get("layers") === "1") document.querySelector<HTMLButtonElement>(".lim-xray")?.click();
});
