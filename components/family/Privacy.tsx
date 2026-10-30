import f from "./family.module.css";

/** What happens to a family's recording and photos, in plain words. */
export function Privacy() {
  return (
    <section className={f.privacy} aria-labelledby="family-privacy">
      <h3 id="family-privacy">Private by default</h3>
      <ul>
        <li>The recording, its transcript and any photos stay on this server, beside the book. They are sent to Meta’s Model API only to be transcribed, read and masked, and are never published.</li>
        <li>The book is unlisted: it is never on the shelf, and its address carries a random part, so only people you give the link to can open it.</li>
        <li>Photos are only traced into pen lines; no face is ever generated from them.</li>
        <li>A delete button on the book’s recording page removes the book, the recording, the transcript and every picture from this server.</li>
      </ul>
    </section>
  );
}
