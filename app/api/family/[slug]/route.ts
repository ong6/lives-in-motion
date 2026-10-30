/**
 * GET    /api/family/<slug> → the job as JSON (polling fallback for the event stream).
 * DELETE /api/family/<slug> (header x-family-key) → removes the book, its recording, transcript
 *        and pictures from this server. Only the maker's key can; the sample stays.
 */
import { deleteBook, getJob } from "@/pipeline/family";
import { budgetNow } from "@/pipeline/jobs/guard";
import { SLUG } from "@/pipeline/jobs/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const job = SLUG.test(slug) ? getJob(slug) : null;
  if (!job) return Response.json({ error: "No such family book." }, { status: 404 });
  return Response.json({ job, budget: budgetNow() }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG.test(slug)) return Response.json({ error: "No such family book." }, { status: 404 });
  const r = await deleteBook(slug, req.headers.get("x-family-key"));
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json({ deleted: slug });
}
