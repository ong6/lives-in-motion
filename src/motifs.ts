/**
 * Built-in cut-paper motifs. They stand in for generated cut-outs until the Meta pipeline
 * has run, so every story renders offline, and they set the visual bar the generated layers
 * are prompted to match. Figures are always silhouettes or seen from behind: no likenesses.
 *
 * Each motif draws into its own viewBox using four inks: paper, ink, accent, accent2.
 */
export interface Inks {
  paper: string;
  ink: string;
  accent: string;
  accent2: string;
}

interface Motif {
  w: number;
  h: number;
  draw: (c: Inks, text?: string) => string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** A person from behind: head, shoulders, coat. `kind` changes proportions only. */
function figure(c: Inks, kind: "adult" | "child" | "tall" | "walk"): string {
  const k = { adult: 1, child: 0.62, tall: 1.12, walk: 1 }[kind];
  const t = (v: number) => (v * k).toFixed(1);
  const legs =
    kind === "walk"
      ? `<path d="M${t(46)} ${t(150)} L${t(34)} ${t(232)} L${t(48)} ${t(232)} L${t(58)} ${t(160)}Z M${t(62)} ${t(150)} L${t(82)} ${t(228)} L${t(94)} ${t(224)} L${t(74)} ${t(150)}Z" fill="${c.ink}"/>`
      : `<rect x="${t(42)}" y="${t(150)}" width="${t(16)}" height="${t(84)}" fill="${c.ink}"/><rect x="${t(62)}" y="${t(150)}" width="${t(16)}" height="${t(84)}" fill="${c.ink}"/>`;
  return `<g transform="translate(${(60 - 60 * k).toFixed(1)} ${(240 - 240 * k).toFixed(1)})">
    ${legs}
    <path d="M${t(30)} ${t(70)} Q${t(60)} ${t(52)} ${t(90)} ${t(70)} L${t(96)} ${t(158)} L${t(24)} ${t(158)}Z" fill="${c.ink}"/>
    <circle cx="${t(60)}" cy="${t(38)}" r="${t(22)}" fill="${c.ink}"/>
  </g>`;
}

export const MOTIFS: Record<string, Motif> = {
  "figure-adult": { w: 120, h: 240, draw: (c) => figure(c, "adult") },
  "figure-child": { w: 120, h: 240, draw: (c) => figure(c, "child") },
  "figure-tall": { w: 120, h: 240, draw: (c) => figure(c, "tall") },
  "figure-walk": { w: 120, h: 240, draw: (c) => figure(c, "walk") },

  crowd: {
    w: 600,
    h: 140,
    draw: (c) =>
      Array.from({ length: 13 }, (_, i) => {
        const x = 20 + i * 45 + (i % 2) * 8;
        const s = 0.8 + ((i * 37) % 5) / 12;
        return `<g transform="translate(${x} ${140 - 120 * s}) scale(${s})"><circle cx="20" cy="18" r="14" fill="${c.ink}"/><path d="M0 120 Q2 40 20 36 Q38 40 40 120Z" fill="${c.ink}"/></g>`;
      }).join(""),
  },

  "stilt-huts": {
    w: 520,
    h: 300,
    draw: (c) =>
      [0, 1, 2]
        .map((i) => {
          const x = i * 170;
          const h = 110 + (i % 2) * 24;
          return `<g transform="translate(${x} ${300 - h - 70})">
            <rect x="20" y="${h}" width="8" height="70" fill="${c.ink}"/><rect x="132" y="${h}" width="8" height="70" fill="${c.ink}"/><rect x="76" y="${h}" width="8" height="70" fill="${c.ink}"/>
            <rect x="12" y="40" width="136" height="${h - 40}" fill="${c.accent}"/>
            <path d="M0 46 L80 0 L160 46Z" fill="${c.accent2}"/>
            <path d="M8 44 L80 6 L152 44" stroke="${c.paper}" stroke-width="2" fill="none" stroke-dasharray="6 6"/>
            <rect x="60" y="${h - 50}" width="34" height="50" fill="${c.ink}"/>
            <rect x="24" y="64" width="24" height="20" fill="${c.paper}"/>
          </g>`;
        })
        .join(""),
  },

  "shophouses": {
    w: 640,
    h: 300,
    draw: (c) =>
      Array.from({ length: 5 }, (_, i) => {
        const x = i * 128;
        const fill = i % 2 ? c.accent : c.accent2;
        return `<g transform="translate(${x} 40)">
          <rect x="0" y="30" width="124" height="230" fill="${fill}"/>
          <path d="M-4 34 L62 0 L128 34Z" fill="${c.ink}"/>
          <rect x="16" y="60" width="26" height="50" rx="13" fill="${c.paper}"/><rect x="50" y="60" width="26" height="50" rx="13" fill="${c.paper}"/><rect x="84" y="60" width="26" height="50" rx="13" fill="${c.paper}"/>
          <rect x="0" y="140" width="124" height="10" fill="${c.ink}"/>
          <path d="M14 260 V190 Q62 160 110 190 V260Z" fill="${c.ink}"/>
        </g>`;
      }).join(""),
  },

  "hdb-blocks": {
    w: 560,
    h: 420,
    draw: (c) =>
      [
        [0, 120, 150],
        [180, 40, 170],
        [380, 90, 160],
      ]
        .map(([x, y, w]) => {
          const rows = Math.floor((420 - y - 20) / 26);
          const win = Array.from({ length: rows }, (_, r) =>
            Array.from({ length: 5 }, (_, k) =>
              `<rect x="${x + 14 + k * ((w - 28) / 5)}" y="${y + 18 + r * 26}" width="${(w - 28) / 5 - 8}" height="12" fill="${(r + k) % 7 === 0 ? c.accent2 : c.paper}"/>`,
            ).join(""),
          ).join("");
          return `<rect x="${x}" y="${y}" width="${w}" height="${420 - y}" fill="${c.accent}"/><rect x="${x}" y="${y}" width="${w}" height="8" fill="${c.ink}"/>${win}`;
        })
        .join(""),
  },

  crane: {
    w: 300,
    h: 420,
    draw: (c) => `<rect x="140" y="40" width="16" height="380" fill="${c.ink}"/>
      <path d="M140 40 L156 40 L156 420 L140 420Z M140 60 L156 80 M156 100 L140 120" stroke="${c.paper}" stroke-width="3"/>
      <rect x="20" y="40" width="270" height="12" fill="${c.ink}"/><rect x="230" y="52" width="40" height="30" fill="${c.ink}"/>
      <line x1="60" y1="52" x2="60" y2="190" stroke="${c.ink}" stroke-width="3"/><rect x="40" y="190" width="40" height="22" fill="${c.accent2}"/>`,
  },

  "rain-tree": {
    w: 420,
    h: 360,
    draw: (c) => `<path d="M196 360 L204 220 Q170 200 120 206 Q178 190 206 200 L214 140 L226 200 Q260 180 300 190 Q256 200 232 222 L240 360Z" fill="${c.ink}"/>
      <ellipse cx="210" cy="120" rx="200" ry="90" fill="${c.accent2}"/>
      <ellipse cx="120" cy="140" rx="100" ry="50" fill="${c.accent2}"/><ellipse cx="310" cy="140" rx="100" ry="50" fill="${c.accent2}"/>
      <path d="M40 150 Q210 60 380 150" stroke="${c.paper}" stroke-width="3" fill="none" opacity=".5"/>`,
  },

  palm: {
    w: 240,
    h: 400,
    draw: (c) => `<path d="M112 400 Q100 240 130 110 L142 112 Q118 240 130 400Z" fill="${c.ink}"/>
      ${[-70, -30, 10, 50, 100, 150, 200].map((a) => `<path d="M136 110 q60 -10 100 40 q-50 -30 -100 -36Z" transform="rotate(${a} 136 110)" fill="${c.accent2}"/>`).join("")}`,
  },

  toilet: {
    w: 260,
    h: 300,
    draw: (c) => `<rect x="150" y="10" width="90" height="120" rx="10" fill="${c.paper}" stroke="${c.ink}" stroke-width="6"/>
      <rect x="170" y="0" width="50" height="14" rx="4" fill="${c.ink}"/>
      <path d="M20 140 H240 Q240 210 170 226 L180 290 H70 L80 226 Q20 210 20 140Z" fill="${c.paper}" stroke="${c.ink}" stroke-width="6"/>
      <ellipse cx="120" cy="140" rx="104" ry="18" fill="${c.ink}"/>
      <path d="M50 160 Q120 190 200 160" stroke="${c.accent2}" stroke-width="5" fill="none" opacity=".6"/>`,
  },

  "toilet-gold": {
    w: 260,
    h: 340,
    draw: (c) => `<g>${MOTIFS.toilet.draw({ ...c, paper: "#e8b830" })}</g>
      <rect x="40" y="296" width="180" height="40" fill="${c.ink}"/><rect x="60" y="306" width="140" height="6" fill="#e8b830"/>`,
  },

  globe: {
    w: 320,
    h: 340,
    draw: (c) => `<circle cx="160" cy="150" r="140" fill="${c.accent2}"/>
      <path d="M70 80 Q110 60 140 90 Q130 130 90 140 Q60 120 70 80Z M180 60 Q240 70 260 120 Q230 150 200 130 Q170 100 180 60Z M150 180 Q200 170 220 220 Q190 270 160 250 Q140 210 150 180Z" fill="${c.paper}"/>
      <ellipse cx="160" cy="150" rx="140" ry="40" fill="none" stroke="${c.ink}" stroke-width="3" opacity=".5"/>
      <ellipse cx="160" cy="150" rx="50" ry="140" fill="none" stroke="${c.ink}" stroke-width="3" opacity=".5"/>
      <rect x="150" y="290" width="20" height="30" fill="${c.ink}"/><rect x="90" y="318" width="140" height="18" rx="6" fill="${c.ink}"/>`,
  },

  banner: {
    w: 520,
    h: 160,
    draw: (c, text = "") => `<line x1="20" y1="0" x2="20" y2="160" stroke="${c.ink}" stroke-width="8"/><line x1="500" y1="0" x2="500" y2="160" stroke="${c.ink}" stroke-width="8"/>
      <path d="M20 20 H500 V110 L470 96 L440 110 L410 96 L380 110 L350 96 L320 110 L290 96 L260 110 L230 96 L200 110 L170 96 L140 110 L110 96 L80 110 L50 96 L20 110Z" fill="${c.accent}"/>
      <text x="260" y="76" text-anchor="middle" font-family="var(--display)" font-size="40" fill="${c.paper}">${esc(text)}</text>`,
  },

  "flag-sg": {
    w: 300,
    h: 320,
    draw: (c) => `<rect x="10" y="0" width="8" height="320" fill="${c.ink}"/>
      <path d="M18 14 Q150 0 290 20 V100 Q150 80 18 94Z" fill="#d52b1e"/>
      <path d="M18 94 Q150 80 290 100 V180 Q150 160 18 174Z" fill="#fff"/>
      <circle cx="70" cy="54" r="26" fill="#fff"/><circle cx="82" cy="52" r="24" fill="#d52b1e"/>
      ${[0, 1, 2, 3, 4].map((i) => { const a = (i * 72 - 90) * Math.PI / 180; return `<circle cx="${(112 + 16 * Math.cos(a)).toFixed(1)}" cy="${(54 + 16 * Math.sin(a)).toFixed(1)}" r="4" fill="#fff"/>`; }).join("")}`,
  },

  "flag-half": {
    w: 200,
    h: 420,
    draw: (c) => `<rect x="20" y="0" width="8" height="420" fill="${c.ink}"/><circle cx="24" cy="0" r="8" fill="${c.ink}"/>
      <path d="M28 160 Q110 150 190 166 V214 Q110 200 28 210Z" fill="#d52b1e"/><path d="M28 210 Q110 200 190 214 V262 Q110 248 28 258Z" fill="#fff"/>`,
  },

  microphones: {
    w: 460,
    h: 220,
    draw: (c) => `<rect x="0" y="150" width="460" height="70" fill="${c.ink}"/><rect x="0" y="150" width="460" height="10" fill="${c.accent}"/>
      ${[90, 160, 230, 300, 370].map((x, i) => `<line x1="${x}" y1="150" x2="${x + (i - 2) * 12}" y2="${50 + (i % 2) * 20}" stroke="${c.ink}" stroke-width="6"/><rect x="${x + (i - 2) * 12 - 14}" y="${30 + (i % 2) * 20}" width="28" height="40" rx="12" fill="${i % 2 ? c.accent2 : c.ink}"/>`).join("")}`,
  },

  "round-table": {
    w: 440,
    h: 220,
    draw: (c) => `<ellipse cx="220" cy="90" rx="210" ry="56" fill="${c.accent}"/><rect x="200" y="100" width="40" height="110" fill="${c.ink}"/><rect x="140" y="200" width="160" height="16" fill="${c.ink}"/>
      <rect x="110" y="64" width="80" height="50" fill="${c.paper}" transform="rotate(-8 150 90)"/><rect x="230" y="60" width="90" height="56" fill="${c.paper}" transform="rotate(6 270 90)"/>
      <line x1="120" y1="80" x2="180" y2="72" stroke="${c.ink}" stroke-width="3"/><line x1="244" y1="80" x2="306" y2="86" stroke="${c.ink}" stroke-width="3"/>`,
  },

  books: {
    w: 260,
    h: 240,
    draw: (c) =>
      [c.accent, c.ink, c.accent2, c.accent, c.ink]
        .map((f, i) => `<rect x="${20 + (i % 2) * 14}" y="${200 - i * 40}" width="${220 - (i % 3) * 20}" height="36" fill="${f}"/><rect x="${40 + (i % 2) * 14}" y="${214 - i * 40}" width="80" height="6" fill="${c.paper}"/>`)
        .join(""),
  },

  ship: {
    w: 640,
    h: 260,
    draw: (c) => `<path d="M0 150 H640 L590 240 H40Z" fill="${c.ink}"/><rect x="120" y="100" width="380" height="50" fill="${c.paper}"/><rect x="180" y="60" width="240" height="40" fill="${c.paper}"/>
      ${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `<circle cx="${150 + i * 40}" cy="125" r="8" fill="${c.ink}"/>`).join("")}
      <rect x="230" y="0" width="44" height="60" fill="${c.accent}"/><rect x="330" y="10" width="44" height="50" fill="${c.accent}"/><rect x="230" y="0" width="44" height="12" fill="${c.ink}"/><rect x="330" y="10" width="44" height="12" fill="${c.ink}"/>`,
  },

  "clock-tower": {
    w: 420,
    h: 420,
    draw: (c) => `<rect x="0" y="220" width="420" height="200" fill="${c.paper}" stroke="${c.ink}" stroke-width="6"/>
      ${[0, 1, 2, 3, 4, 5].map((i) => `<path d="M${24 + i * 66} 420 V300 Q${50 + i * 66} 270 ${76 + i * 66} 300 V420Z" fill="${c.ink}"/>`).join("")}
      <rect x="0" y="210" width="420" height="20" fill="${c.ink}"/>
      <rect x="160" y="60" width="100" height="160" fill="${c.paper}" stroke="${c.ink}" stroke-width="6"/><path d="M150 64 L210 0 L270 64Z" fill="${c.accent}"/>
      <circle cx="210" cy="120" r="34" fill="${c.paper}" stroke="${c.ink}" stroke-width="6"/><line x1="210" y1="120" x2="210" y2="96" stroke="${c.ink}" stroke-width="5"/><line x1="210" y1="120" x2="228" y2="128" stroke="${c.ink}" stroke-width="5"/>`,
  },

  rickshaw: {
    w: 380,
    h: 240,
    draw: (c) => `<circle cx="120" cy="170" r="64" fill="none" stroke="${c.ink}" stroke-width="10"/>
      ${[0, 30, 60, 90, 120, 150].map((a) => `<line x1="120" y1="170" x2="${(120 + 60 * Math.cos(a * Math.PI / 180)).toFixed(1)}" y2="${(170 + 60 * Math.sin(a * Math.PI / 180)).toFixed(1)}" stroke="${c.ink}" stroke-width="3" transform="rotate(0)"/>`).join("")}
      <path d="M40 120 Q60 30 160 40 L190 120Z" fill="${c.accent}"/><rect x="60" y="110" width="140" height="20" fill="${c.ink}"/>
      <line x1="190" y1="120" x2="380" y2="150" stroke="${c.ink}" stroke-width="8"/>`,
  },

  bicycle: {
    w: 320,
    h: 200,
    draw: (c) => `<circle cx="70" cy="140" r="54" fill="none" stroke="${c.ink}" stroke-width="8"/><circle cx="250" cy="140" r="54" fill="none" stroke="${c.ink}" stroke-width="8"/>
      <path d="M70 140 L140 140 L210 70 L120 70Z M140 140 L250 140 M210 70 L250 140 M120 70 L110 40 H90" stroke="${c.ink}" stroke-width="8" fill="none" stroke-linejoin="round"/>
      <path d="M200 50 H236" stroke="${c.ink}" stroke-width="10"/><rect x="216" y="56" width="50" height="22" fill="${c.accent}"/>`,
  },

  "rising-sun": {
    w: 420,
    h: 280,
    draw: (c) => `<rect x="0" y="0" width="420" height="280" fill="${c.paper}" stroke="${c.ink}" stroke-width="6"/>
      ${Array.from({ length: 16 }, (_, i) => { const a = (i * 22.5) * Math.PI / 180; return `<path d="M210 140 L${(210 + 400 * Math.cos(a)).toFixed(0)} ${(140 + 400 * Math.sin(a)).toFixed(0)} L${(210 + 400 * Math.cos(a + 0.2)).toFixed(0)} ${(140 + 400 * Math.sin(a + 0.2)).toFixed(0)}Z" fill="${c.accent}"/>`; }).join("")}
      <circle cx="210" cy="140" r="54" fill="${c.accent}"/>`,
  },

  lamp: {
    w: 120,
    h: 200,
    draw: (c) => `<rect x="30" y="150" width="60" height="40" rx="8" fill="${c.ink}"/><path d="M36 150 Q20 90 60 60 Q100 90 84 150Z" fill="${c.accent2}" opacity=".85"/>
      <path d="M60 80 Q50 110 60 130 Q70 110 60 80Z" fill="#f6c453"/><rect x="40" y="40" width="40" height="20" fill="${c.ink}"/><path d="M50 40 Q60 10 70 40" stroke="${c.ink}" stroke-width="4" fill="none"/>`,
  },

  bucket: {
    w: 160,
    h: 160,
    draw: (c) => `<path d="M20 50 H140 L124 150 H36Z" fill="${c.accent2}"/><ellipse cx="80" cy="50" rx="60" ry="12" fill="${c.ink}"/><path d="M24 50 Q80 -20 136 50" stroke="${c.ink}" stroke-width="5" fill="none"/>`,
  },

  "latrine-shed": {
    w: 200,
    h: 300,
    draw: (c) => `<path d="M10 70 L100 30 L190 70Z" fill="${c.accent2}"/><rect x="20" y="70" width="160" height="230" fill="${c.accent}"/>
      ${[40, 70, 100, 130, 160].map((x) => `<line x1="${x}" y1="70" x2="${x}" y2="300" stroke="${c.ink}" stroke-width="2" opacity=".5"/>`).join("")}
      <rect x="60" y="120" width="80" height="180" fill="${c.ink}"/><path d="M90 140 a10 14 0 1 0 20 0 a10 14 0 1 0 -20 0" fill="${c.paper}"/>`,
  },

  hardhat: {
    w: 220,
    h: 140,
    draw: (c) => `<path d="M20 110 Q20 20 110 20 Q200 20 200 110Z" fill="#f2b134"/><rect x="0" y="104" width="220" height="22" rx="8" fill="#f2b134" stroke="${c.ink}" stroke-width="4"/><rect x="98" y="20" width="24" height="86" fill="${c.ink}" opacity=".25"/>`,
  },

  crates: {
    w: 340,
    h: 220,
    draw: (c) =>
      [
        [0, 100],
        [120, 100],
        [60, 0],
      ]
        .map(([x, y]) => `<rect x="${x + 10}" y="${y + 10}" width="110" height="110" fill="${c.accent}" stroke="${c.ink}" stroke-width="6"/><path d="M${x + 10} ${y + 10} L${x + 120} ${y + 120} M${x + 120} ${y + 10} L${x + 10} ${y + 120}" stroke="${c.ink}" stroke-width="4"/>`)
        .join(""),
  },

  blueprint: {
    w: 360,
    h: 240,
    draw: (c) => `<rect x="0" y="20" width="340" height="210" fill="#2f5d8a" transform="rotate(-4 170 120)"/>
      <g transform="rotate(-4 170 120)" stroke="#e8f0f8" stroke-width="3" fill="none"><rect x="40" y="60" width="120" height="120"/><rect x="160" y="60" width="120" height="70"/><path d="M160 130 H280 V180 H160"/><circle cx="100" cy="120" r="20"/></g>`,
  },

  door: {
    w: 200,
    h: 340,
    draw: (c) => `<rect x="0" y="0" width="200" height="340" fill="${c.ink}"/><path d="M20 20 H180 V340 H20Z" fill="${c.accent}"/><path d="M20 20 L120 40 V340 L20 340Z" fill="${c.paper}" opacity=".35"/><circle cx="104" cy="190" r="8" fill="${c.ink}"/>`,
  },

  "wc-sign": {
    w: 220,
    h: 220,
    draw: (c) => `<rect x="0" y="0" width="220" height="220" rx="24" fill="${c.accent2}"/>
      <circle cx="70" cy="60" r="18" fill="${c.paper}"/><path d="M48 90 H92 V160 H48Z" fill="${c.paper}"/>
      <circle cx="150" cy="60" r="18" fill="${c.paper}"/><path d="M150 84 L184 160 H116Z" fill="${c.paper}"/><rect x="108" y="40" width="4" height="140" fill="${c.paper}"/>
      <text x="110" y="205" text-anchor="middle" font-family="var(--display)" font-size="26" fill="${c.paper}">★★★★★</text>`,
  },

  magazine: {
    w: 260,
    h: 340,
    draw: (c, text = "HEROES") => `<rect x="0" y="0" width="260" height="340" fill="${c.paper}" stroke="#c8102e" stroke-width="16"/>
      <text x="130" y="70" text-anchor="middle" font-family="var(--display)" font-size="54" fill="#c8102e">${esc(text)}</text>
      <circle cx="130" cy="190" r="56" fill="${c.ink}"/><path d="M50 340 Q60 260 130 250 Q200 260 210 340Z" fill="${c.ink}"/>`,
  },

  medal: {
    w: 160,
    h: 280,
    draw: (c) => `<path d="M40 0 L80 120 L120 0Z" fill="${c.accent}"/><path d="M40 0 L60 0 L90 110 L80 120Z" fill="${c.accent2}"/>
      <circle cx="80" cy="190" r="72" fill="#e8b830" stroke="#b5871b" stroke-width="8"/><circle cx="80" cy="190" r="46" fill="none" stroke="#b5871b" stroke-width="4"/>
      <path d="M80 160 l9 20 22 2 -17 14 6 22 -20 -12 -20 12 6 -22 -17 -14 22 -2Z" fill="#b5871b"/>`,
  },

  seedling: {
    w: 160,
    h: 220,
    draw: (c) => `<path d="M76 220 Q70 140 80 80" stroke="${c.ink}" stroke-width="8" fill="none"/>
      <path d="M80 110 Q20 110 10 50 Q70 50 80 110Z" fill="${c.accent2}"/><path d="M80 90 Q140 80 150 20 Q90 20 80 90Z" fill="${c.accent2}"/>`,
  },

  "un-hall": {
    w: 900,
    h: 420,
    draw: (c) => `<rect x="0" y="0" width="900" height="420" fill="${c.ink}" opacity=".08"/>
      <path d="M150 40 H750 L700 300 H200Z" fill="#f2b134" opacity=".9"/>
      <circle cx="450" cy="150" r="70" fill="none" stroke="${c.ink}" stroke-width="8"/><path d="M380 150 H520 M450 80 V220 M395 110 Q450 130 505 110 M395 190 Q450 170 505 190" stroke="${c.ink}" stroke-width="4" fill="none"/>
      ${Array.from({ length: 4 }, (_, r) => `<path d="M${40 - r * 20} ${310 + r * 28} H${860 + r * 20}" stroke="${c.accent}" stroke-width="16"/>`).join("")}`,
  },

  "flags-row": {
    w: 700,
    h: 200,
    draw: (c) =>
      Array.from({ length: 10 }, (_, i) => {
        const x = 20 + i * 68;
        const f = [c.accent, c.accent2, "#f2b134", c.ink, "#fff"][i % 5];
        return `<rect x="${x}" y="0" width="5" height="200" fill="${c.ink}"/><path d="M${x + 5} 8 Q${x + 30} 0 ${x + 58} 12 V52 Q${x + 30} 42 ${x + 5} 48Z" fill="${f}" stroke="${c.ink}" stroke-width="1.5"/>`;
      }).join(""),
  },

  calendar: {
    w: 220,
    h: 260,
    draw: (c, text = "19 NOV") => {
      const [day, mon] = text.split(" ");
      return `<rect x="0" y="20" width="220" height="240" rx="14" fill="${c.paper}" stroke="${c.ink}" stroke-width="6"/><rect x="0" y="20" width="220" height="64" rx="14" fill="${c.accent}"/>
      <rect x="44" y="0" width="16" height="44" rx="6" fill="${c.ink}"/><rect x="160" y="0" width="16" height="44" rx="6" fill="${c.ink}"/>
      <text x="110" y="70" text-anchor="middle" font-family="var(--display)" font-size="36" fill="${c.paper}">${esc(mon ?? "")}</text>
      <text x="110" y="210" text-anchor="middle" font-family="var(--display)" font-size="110" fill="${c.ink}">${esc(day ?? "")}</text>`;
    },
  },

  "film-screen": {
    w: 760,
    h: 440,
    draw: (c) => `<rect x="0" y="0" width="760" height="440" fill="${c.ink}"/>
      ${Array.from({ length: 19 }, (_, i) => `<rect x="${14 + i * 40}" y="12" width="20" height="18" rx="3" fill="${c.paper}"/><rect x="${14 + i * 40}" y="410" width="20" height="18" rx="3" fill="${c.paper}"/>`).join("")}
      <rect x="40" y="50" width="680" height="340" fill="${c.paper}"/><path d="M40 50 L380 220 L40 390Z" fill="${c.accent2}" opacity=".18"/>`,
  },

  duck: {
    w: 220,
    h: 180,
    draw: (c) => `<ellipse cx="110" cy="120" rx="96" ry="56" fill="#f6c453"/><circle cx="150" cy="60" r="44" fill="#f6c453"/>
      <path d="M186 56 L220 66 L188 80Z" fill="${c.accent}"/><circle cx="160" cy="48" r="7" fill="${c.ink}"/><path d="M40 110 Q90 150 140 110" stroke="#d9a72c" stroke-width="6" fill="none"/>`,
  },

  "pool-lanes": {
    w: 1000,
    h: 360,
    draw: (c) => `<path d="M120 0 H880 L1000 360 H0Z" fill="${c.accent2}"/>
      ${Array.from({ length: 7 }, (_, i) => { const t = 120 + i * (760 / 8) + 760 / 8; const b = (i + 1) * (1000 / 8); return `<line x1="${t}" y1="0" x2="${b}" y2="360" stroke="${c.paper}" stroke-width="6" stroke-dasharray="14 10"/>`; }).join("")}
      <path d="M0 330 Q250 300 500 330 T1000 330" stroke="${c.paper}" stroke-width="3" fill="none" opacity=".5"/>`,
  },

  swimmer: {
    w: 320,
    h: 140,
    draw: (c) => `<path d="M20 90 Q160 50 300 80" stroke="${c.paper}" stroke-width="10" fill="none" opacity=".6"/>
      <circle cx="250" cy="70" r="22" fill="${c.ink}"/><path d="M60 92 Q150 64 232 76 L228 98 Q150 92 70 110Z" fill="${c.ink}"/>
      <path d="M230 74 Q260 10 300 40" stroke="${c.ink}" stroke-width="14" fill="none" stroke-linecap="round"/>`,
  },

  scoreboard: {
    w: 520,
    h: 280,
    draw: (c, text = "") => `<rect x="0" y="0" width="520" height="260" rx="10" fill="#0d1420"/><rect x="16" y="16" width="488" height="40" fill="#1d2a3e"/>
      <text x="30" y="46" font-family="'IBM Plex Mono', monospace" font-size="24" fill="#f2b134">MEN'S 100M BUTTERFLY · FINAL</text>
      <text x="260" y="170" text-anchor="middle" font-family="'IBM Plex Mono', monospace" font-size="96" fill="#f6c453">${esc(text)}</text>
      <text x="260" y="226" text-anchor="middle" font-family="'IBM Plex Mono', monospace" font-size="22" fill="#9fb3c8">OLYMPIC RECORD</text>
      <rect x="240" y="260" width="40" height="20" fill="#0d1420"/>`,
  },

  stopwatch: {
    w: 200,
    h: 240,
    draw: (c) => `<rect x="84" y="0" width="32" height="24" fill="${c.ink}"/><circle cx="100" cy="140" r="94" fill="${c.paper}" stroke="${c.ink}" stroke-width="12"/>
      <line x1="100" y1="140" x2="100" y2="70" stroke="${c.accent}" stroke-width="7" stroke-linecap="round"/><circle cx="100" cy="140" r="9" fill="${c.ink}"/>
      ${Array.from({ length: 12 }, (_, i) => { const a = i * 30 * Math.PI / 180; return `<line x1="${(100 + 76 * Math.sin(a)).toFixed(1)}" y1="${(140 - 76 * Math.cos(a)).toFixed(1)}" x2="${(100 + 86 * Math.sin(a)).toFixed(1)}" y2="${(140 - 86 * Math.cos(a)).toFixed(1)}" stroke="${c.ink}" stroke-width="4"/>`; }).join("")}`,
  },

  suitcase: {
    w: 260,
    h: 220,
    draw: (c) => `<rect x="90" y="0" width="80" height="40" rx="12" fill="none" stroke="${c.ink}" stroke-width="12"/><rect x="0" y="34" width="260" height="180" rx="18" fill="${c.accent}"/>
      <rect x="60" y="34" width="14" height="180" fill="${c.ink}"/><rect x="186" y="34" width="14" height="180" fill="${c.ink}"/>
      <rect x="150" y="90" width="80" height="50" fill="${c.paper}" transform="rotate(10 190 115)"/><text x="190" y="122" text-anchor="middle" font-family="'IBM Plex Mono', monospace" font-size="18" fill="${c.ink}" transform="rotate(10 190 115)">SIN→JAX</text>`,
  },

  goggles: {
    w: 240,
    h: 100,
    draw: (c) => `<path d="M0 50 Q120 0 240 50" stroke="${c.ink}" stroke-width="6" fill="none"/><ellipse cx="80" cy="56" rx="46" ry="32" fill="${c.accent2}" stroke="${c.ink}" stroke-width="6"/><ellipse cx="160" cy="56" rx="46" ry="32" fill="${c.accent2}" stroke="${c.ink}" stroke-width="6"/>
      <ellipse cx="66" cy="46" rx="14" ry="8" fill="${c.paper}" opacity=".7"/><ellipse cx="146" cy="46" rx="14" ry="8" fill="${c.paper}" opacity=".7"/>`,
  },

  "starting-block": {
    w: 220,
    h: 200,
    draw: (c) => `<path d="M20 60 H200 L180 120 H40Z" fill="${c.paper}" stroke="${c.ink}" stroke-width="6"/><rect x="40" y="120" width="20" height="80" fill="${c.ink}"/><rect x="160" y="120" width="20" height="80" fill="${c.ink}"/>
      <text x="110" y="104" text-anchor="middle" font-family="var(--display)" font-size="40" fill="${c.ink}">4</text>`,
  },

  confetti: {
    w: 800,
    h: 400,
    draw: (c) =>
      Array.from({ length: 70 }, (_, i) => {
        const x = (i * 131) % 800;
        const y = (i * 71) % 400;
        const f = [c.accent, c.accent2, "#f2b134", "#fff"][i % 4];
        return `<rect x="${x}" y="${y}" width="${10 + (i % 3) * 4}" height="${6 + (i % 2) * 4}" fill="${f}" transform="rotate(${(i * 47) % 180} ${x} ${y})"/>`;
      }).join(""),
  },

  "camera-flash": {
    w: 300,
    h: 300,
    draw: (c) => `<path d="M150 0 L172 118 L300 150 L172 182 L150 300 L128 182 L0 150 L128 118Z" fill="#fff6d6"/><circle cx="150" cy="150" r="40" fill="#fff"/>`,
  },

  flowers: {
    w: 360,
    h: 200,
    draw: (c) =>
      Array.from({ length: 14 }, (_, i) => {
        const x = 20 + i * 24;
        const y = 120 - ((i * 37) % 60);
        return `<line x1="${x}" y1="${y}" x2="${180}" y2="200" stroke="${c.accent2}" stroke-width="4"/><circle cx="${x}" cy="${y}" r="16" fill="${i % 3 ? "#fff" : "#f2e6c2"}" stroke="${c.ink}" stroke-width="2"/><circle cx="${x}" cy="${y}" r="5" fill="#f2b134"/>`;
      }).join("") + `<path d="M140 150 L220 150 L200 200 H160Z" fill="${c.accent}"/>`,
  },

  handkerchief: {
    w: 160,
    h: 140,
    draw: (c) => `<path d="M10 30 Q80 0 150 26 L136 130 Q80 110 20 130Z" fill="#fff" stroke="${c.ink}" stroke-width="4"/><path d="M30 40 Q80 20 130 38" stroke="${c.accent2}" stroke-width="3" fill="none"/>`,
  },

  briefcase: {
    w: 240,
    h: 200,
    draw: (c) => `<rect x="80" y="0" width="80" height="40" rx="10" fill="none" stroke="${c.ink}" stroke-width="12"/><rect x="0" y="36" width="240" height="160" rx="12" fill="${c.ink}"/><rect x="0" y="96" width="240" height="8" fill="${c.accent}"/><rect x="108" y="88" width="24" height="24" fill="#e8b830"/>`,
  },

  "two-flags": {
    w: 560,
    h: 320,
    draw: (c) => `<rect x="10" y="0" width="8" height="320" fill="${c.ink}"/><path d="M18 14 Q130 0 250 18 V170 Q130 152 18 168Z" fill="#1d3f8f"/>
      ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="18" y="${14 + i * 22}" width="232" height="11" fill="${i % 2 ? "#fff" : "#c8102e"}" opacity=".9"/>`).join("")}
      <rect x="18" y="14" width="110" height="80" fill="#1d3f8f"/><circle cx="60" cy="54" r="22" fill="#f2b134"/><circle cx="68" cy="54" r="19" fill="#1d3f8f"/>
      <rect x="542" y="0" width="8" height="320" fill="${c.ink}"/><path d="M542 14 Q430 0 310 18 V94 Q430 80 542 92Z" fill="#d52b1e"/><path d="M542 92 Q430 80 310 94 V170 Q430 156 542 168Z" fill="#fff"/>`,
  },

  "ground-band": {
    w: 1600,
    h: 160,
    draw: (c) => `<path d="M0 40 Q400 0 800 30 T1600 20 V160 H0Z" fill="${c.ink}" opacity=".9"/>`,
  },

  "sky-sun": {
    w: 260,
    h: 260,
    draw: (c) => `<circle cx="130" cy="130" r="110" fill="${c.accent}" opacity=".9"/><circle cx="130" cy="130" r="128" fill="none" stroke="${c.accent}" stroke-width="4" stroke-dasharray="4 10"/>`,
  },
};

export function motifSvg(name: string, inks: Inks, text?: string): string {
  const m = MOTIFS[name];
  if (!m) throw new Error(`unknown motif: ${name}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.w} ${m.h}" preserveAspectRatio="xMidYMax meet" aria-hidden="true">${m.draw(inks, text)}</svg>`;
}

export function motifAspect(name: string): number {
  const m = MOTIFS[name];
  return m ? m.h / m.w : 1;
}
