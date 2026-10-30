/**
 * A job's Server-Sent Events: each `data:` is { job, budget }, sent on every change (at most four
 * a second, the runner's batching) and closed once the job has finished. Reconnecting gets the
 * current state straight away, so a refresh picks up where the page was. A comment line every
 * 15 s keeps proxies from closing a quiet stream.
 */
import type { Budget } from "./types";

export interface JobSource<J extends { slug: string; status: string }> {
  getJob: (slug: string) => J | null;
  subscribe: (fn: (job: J) => void) => () => void;
}

export function jobStream<J extends { slug: string; status: string }>(req: Request, slug: string, src: JobSource<J>, budget: () => Budget): Response {
  const enc = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      let closed = false;
      const send = (job: J) => {
        if (closed) return;
        try {
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ job, budget: budget() })}\n\n`));
        } catch {
          return stop();
        }
        if (job.status !== "running") stop();
      };
      const off = src.subscribe((job) => job.slug === slug && send(job));
      const beat = setInterval(() => !closed && ctrl.enqueue(enc.encode(`: still here\n\n`)), 15000);
      stop = () => {
        if (closed) return;
        closed = true;
        off();
        clearInterval(beat);
        try {
          ctrl.close();
        } catch {}
      };
      req.signal.addEventListener("abort", stop);
      send(src.getJob(slug)!);
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
