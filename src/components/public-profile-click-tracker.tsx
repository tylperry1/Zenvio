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
      try {
        navigator.sendBeacon(`/p/${slug}/click`, new Blob([payload], { type: "application/json" }));
      } catch {
        void fetch(`/p/${slug}/click`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        });
      }
    }

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [slug, via]);

  return null;
}
