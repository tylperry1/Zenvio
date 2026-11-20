"use client";
import { useEffect } from "react";

const CHANNELS = ["link", "card", "qr", "nfc"] as const;

/** Client-side outbound click attribution — never embeds query strings into raw HTML scripts. */
export function PublicProfileClickTracker({ slug, via }: { slug: string; via?: string }) {
  useEffect(() => {
    const channel =
      typeof via === "string" && (CHANNELS as readonly string[]).includes(via) ? via : "link";

    function onClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("[data-di-action]");
      if (!(anchor instanceof HTMLElement)) return;
      const action = anchor.getAttribute("data-di-action");
      if (!action) return;
      const payload = JSON.stringify({ action, via: channel });
      let queued = false;
      try {
        queued = navigator.sendBeacon(`/p/${slug}/click`, new Blob([payload], { type: "application/json" }));
      } catch {
        queued = false;
      }
      // Beacon false means the request was not queued (quota/unavailable). Fall back without
      // keepalive so an active page still records the click; never double-send when true.
      if (!queued) {
        void fetch(`/p/${slug}/click`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
        }).catch(() => {});
      }
    }

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [slug, via]);

  return null;
}
