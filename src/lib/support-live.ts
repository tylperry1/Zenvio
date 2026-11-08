/**
 * Server-sent events for live support. Each connection checks a cheap change
 * signature every 1.5 s and pushes a "change" event when it moves; the client
 * then refetches through the normal API. Connections end after ~25 s and the
 * browser reconnects automatically, which keeps each serverless invocation short.
 */
export function changeStream(request: Request, probe: () => Promise<unknown>, { intervalMs = 1500, maxMs = 25000 } = {}) {
  const encoder = new TextEncoder();
  const started = Date.now();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {}
      };
      request.signal.addEventListener("abort", close);
      write("retry: 2000\n\n");
      let last = "";
      let lastPing = Date.now();
      try {
        while (!closed && Date.now() - started < maxMs) {
          const signature = JSON.stringify(await probe());
          if (signature !== last) {
            write(`event: change\ndata: ${signature}\n\n`);
            last = signature;
          } else if (Date.now() - lastPing > 10000) {
            write(": ping\n\n");
            lastPing = Date.now();
          }
          await new Promise((r) => setTimeout(r, intervalMs));
        }
      } catch {
        write("event: error\ndata: {}\n\n");
      }
      close();
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
