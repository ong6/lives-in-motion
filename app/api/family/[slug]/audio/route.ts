/**
 * GET /api/family/<slug>/audio → the book's recording (AAC in M4A), with byte ranges so the
 * player can jump straight to a cited moment. Served only from this server, never a CDN; the
 * slug is the book's unguessable name, so the recording is as private as the book.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { recordingFile } from "@/pipeline/family";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const file = /^[a-z0-9-]{1,80}$/.test(slug) ? recordingFile(slug, "m4a") : "";
  if (!file || !existsSync(file)) return new Response("No such recording.", { status: 404 });
  const size = statSync(file).size;
  const head = { "Content-Type": "audio/mp4", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600", "X-Robots-Tag": "noindex" };
  const m = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) {
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { ...head, "Content-Length": String(size) } });
  }
  let start = m[1] ? Number(m[1]) : size - Number(m[2]);
  let end = m[1] && m[2] ? Number(m[2]) : size - 1;
  start = Math.max(0, start);
  end = Math.min(size - 1, end);
  if (start > end) return new Response(null, { status: 416, headers: { ...head, "Content-Range": `bytes */${size}` } });
  return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
    status: 206,
    headers: { ...head, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` },
  });
}
