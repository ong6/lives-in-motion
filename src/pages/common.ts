import "../styles/lim.css";
import "../styles/pages.css";
import { FONT_HREF } from "../eras";

export function boot(): HTMLElement {
  document.querySelector<HTMLLinkElement>("#fonts")!.href = FONT_HREF;
  return document.querySelector<HTMLElement>("#app")!;
}
