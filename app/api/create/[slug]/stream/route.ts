/** GET /api/create/<slug>/stream → Server-Sent Events of the job (pipeline/jobs/stream.ts). */
import { getJob, subscribe } from "@/pipeline/create";
import { budgetNow } from "@/pipeline/jobs/guard";
import { SLUG } from "@/pipeline/jobs/runner";
import { jobStream } from "@/pipeline/jobs/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG.test(slug) || !getJob(slug)) return Response.json({ error: "No such life." }, { status: 404 });
  return jobStream(req, slug, { getJob, subscribe }, budgetNow);
}
