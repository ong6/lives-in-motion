import { Fragment, type CSSProperties } from "react";

/**
 * A heading's words, each in its own mask so they can rise into place in turn. Screen readers
 * get the sentence once, unsplit.
 */
export function Masked({ text, start = 0 }: { text: string; start?: number }) {
  const words = text.split(/\s+/);
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden data-masked>
        {words.map((w, i) => (
          <Fragment key={i}>
            <span data-word-mask>
              <span data-word style={{ "--i": start + i } as CSSProperties}>
                {w}
              </span>
            </span>
            {i < words.length - 1 && " "}
          </Fragment>
        ))}
      </span>
    </>
  );
}
