import type { Overlay as OverlayKind } from "@/lib/schema";

/** Singapore's flag to the official geometry (2:3; crescent and five stars, red over white). */
export function SgFlag({ wave = true }: { wave?: boolean }) {
  return (
    <svg viewBox="0 0 54 36" role="img" aria-label="Flag of Singapore" className={wave ? "flag flag--wave" : "flag"}>
      <defs>
        <path id="sg-star" d="m15.03 3.475-1.01393 3.120554 2.654502-1.928609h-3.281145l2.654502 1.928609z" fill="#fff" />
        <g id="sg-pair">
          <use href="#sg-star" transform="rotate(72 15.03 9)" />
          <use href="#sg-star" transform="rotate(216 15.03 9)" />
        </g>
      </defs>
      <path d="M0 0h54v36H0z" fill="#fff" />
      <path d="M0 0h54v18H0z" fill="#ed2939" />
      <circle cx="11.405" cy="9" r="6.625" fill="#fff" />
      <circle cx="15.03" cy="9" r="7.25" fill="#ed2939" />
      <use href="#sg-star" />
      <use href="#sg-pair" />
      <use href="#sg-pair" transform="rotate(72 15.03 9)" />
    </svg>
  );
}

function Scoreboard({ text }: { text?: string }) {
  return (
    <div className="scoreboard" role="img" aria-label={`Scoreboard: ${text}`}>
      <span className="scoreboard__event">100M BUTTERFLY · FINAL</span>
      <span className="scoreboard__time">{text}</span>
      <span className="scoreboard__note">OLYMPIC RECORD</span>
    </div>
  );
}

function Calendar({ text = "" }: { text?: string }) {
  const [day, month] = text.split(" ");
  return (
    <div className="calendar" role="img" aria-label={`Calendar: ${text}`}>
      <span className="calendar__month">{month}</span>
      <span className="calendar__day">{day}</span>
    </div>
  );
}

export function Overlay({ kind, text }: { kind: OverlayKind; text?: string }) {
  if (kind === "sg-flag") return <SgFlag />;
  if (kind === "scoreboard") return <Scoreboard text={text} />;
  return <Calendar text={text} />;
}
