/**
 * pnpm approve <slug>            put a /create draft on the shelf (it joins the Part chain)
 * pnpm approve <slug> --withdraw take a life off the shelf again; its URL still opens
 * pnpm approve                   list the lives that are off the shelf
 * Lives made on /create are written with `"listed": false` and wait here for the owner.
 */
import { parseArgs } from "node:util";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { edit, loadStory, storyDir } from "./stages";
import { ROOT } from "./root";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { withdraw: { type: "boolean", default: false } } });
const slug = positionals[0];

if (!slug) {
  const off = [];
  for (const s of readdirSync(join(ROOT, "stories"))) {
    if (!existsSync(join(storyDir(s), "story.json"))) continue;
    const st = await loadStory(s);
    if (st.listed === false) off.push(`  ${s.padEnd(24)} ${st.name}`);
  }
  console.log(off.length ? `Off the shelf (pnpm approve <slug> to list):\n${off.join("\n")}` : "Every life is on the shelf.");
} else {
  if (!existsSync(join(storyDir(slug), "story.json"))) {
    console.error(`no stories/${slug}/story.json`);
    process.exit(1);
  }
  const st = await edit(slug, (s) => {
    if (values.withdraw) s.listed = false;
    else delete s.listed;
  });
  console.log(`${st.name}: ${values.withdraw ? "off the shelf (the URL still opens)" : "on the shelf"}`);
}
