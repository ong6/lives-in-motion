import { boot } from "./common";
import { STORIES } from "../stories";
import { DIRECTIONS, h, lifespan, stillFrame } from "../render/frame";

const app = boot();
document.documentElement.dataset.page = "gallery";

/** The scene that best sums each life up, used as its cover. */
const COVER: Record<string, number> = { "jack-sim": 3, "lee-kuan-yew": 4, "joseph-schooling": 4 };

const head = h("header", { class: "g-head" });
head.innerHTML = `<p class="g-kicker">Lives in Motion · a Singapore biography gallery</p>
  <h1>Lives worth<br/><em>watching</em> unfold.</h1>
  <p class="g-lede">Each life is researched with cited sources, illustrated in the style of its era, cut into layers and set moving as you scroll. Text narrates; the pictures tell it.</p>`;

const wall = h("section", { class: "g-wall" });
STORIES.forEach((s, i) => {
  const card = h("a", { class: "g-card", href: `story.html?p=${s.slug}` });
  card.append(stillFrame(s, COVER[s.slug] ?? 0, DIRECTIONS[i % 3].id));
  const meta = h("div", { class: "g-meta" });
  meta.innerHTML = `<span class="g-no">${String(i + 1).padStart(2, "0")}</span><h2>${s.name}</h2><p class="g-dates">${lifespan(s)}</p><p>${s.tagline}</p>`;
  card.append(meta);
  wall.append(card);
});

const how = h("section", { class: "g-how" });
how.innerHTML = `<h2>How a life is made</h2>
  <ol>
    <li><b>Research</b><span>Muse Spark searches the web and writes a timeline where every line carries a citation.</span></li>
    <li><b>Storyboard</b><span>Spark turns the timeline into seven scenes: year, caption, what the picture shows, and which objects become layers.</span></li>
    <li><b>Illustrate</b><span>Muse Image paints each scene in its era's print style, keeping the cast consistent across scenes.</span></li>
    <li><b>Cut</b><span>SAM 3.1 cuts every named object out of the painting, so each one can move on its own.</span></li>
    <li><b>Play</b><span>Code animates the layers by depth, with the era's own easing. Press <i>Layers</i> in any story to see the cut.</span></li>
  </ol>
  <p><a href="styles.html">See the three design directions →</a></p>`;

app.replaceChildren(head, wall, how);
