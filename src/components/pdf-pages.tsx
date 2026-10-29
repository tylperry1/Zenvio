"use client";
import { useEffect, useRef, useState, ReactNode } from "react";
export function PdfPages({
  bytes,
  pages,
  overlay,
  onPlace,
}: {
  bytes: Uint8Array | null;
  pages: { width: number; height: number }[];
  overlay: (page: number) => ReactNode;
  onPlace?: (page: number, x: number, y: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!bytes) return;
    let cancelled = false;
    let task: any, doc: any;
    const renders: any[] = [];
    (async () => {
      try {
        const pdf = await import("pdfjs-dist");
        pdf.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        task = pdf.getDocument({
          data: bytes.slice(),
          disableFontFace: true,
          standardFontDataUrl: "/pdf-assets/standard_fonts/",
          cMapUrl: "/pdf-assets/cmaps/",
          cMapPacked: true,
          wasmUrl: "/pdf-assets/wasm/",
        });
        doc = await task.promise;
        for (let i = 0; i < doc.numPages && !cancelled; i++) {
          const page = await doc.getPage(i + 1);
          if (cancelled) break;
          const canvas = root.current?.querySelectorAll("canvas")[i];
          if (!canvas) break;
          const viewport = page.getViewport({
            scale: Math.min(1.5, 1200 / page.getViewport({ scale: 1 }).width),
          });
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const render = page.render({
            canvasContext: canvas.getContext("2d")!,
            canvas,
            viewport,
          });
          renders.push(render);
          await render.promise;
          if (!cancelled) canvas.dataset.rendered = "true";
        }
      } catch (e) {
        if (!cancelled)
          setError(
            "Unable to render this PDF. Download the original to review it.",
          );
      }
    })();
    return () => {
      cancelled = true;
      for (const r of renders) r.cancel();
      task?.destroy();
    };
  }, [bytes]);
  return (
    <div className="pdf-pages" ref={root}>
      {error && <p role="alert">{error}</p>}
      {pages.map((p, i) => (
        <div
          key={i}
          className="pdf-page"
          style={{ aspectRatio: `${p.width}/${p.height}` }}
          onClick={(e) => {
            if (!onPlace) return;
            const r = e.currentTarget.getBoundingClientRect();
            onPlace(
              i,
              (e.clientX - r.left) / r.width,
              (e.clientY - r.top) / r.height,
            );
          }}
        >
          <canvas aria-label={`Document page ${i + 1}`} />
          <div className="pdf-overlay">{overlay(i)}</div>
          <small className="pdf-page-number">
            {i + 1} / {pages.length}
          </small>
        </div>
      ))}
    </div>
  );
}
