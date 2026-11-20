"use client";

const CHANNELS = ["link", "card", "qr", "nfc"] as const;
type Channel = (typeof CHANNELS)[number];

function allowlistedVia(via?: string): Channel | "" {
  return typeof via === "string" && (CHANNELS as readonly string[]).includes(via) ? (via as Channel) : "";
}

function withVia(path: string, via?: string) {
  const channel = allowlistedVia(via);
  if (!channel) return path;
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}via=${encodeURIComponent(channel)}`;
}

/** Primary CTAs on the public Digital Identity page with click attribution. */
export function PublicProfileActions({
  slug,
  via,
  bookingUrl,
}: {
  slug: string;
  via?: string;
  bookingUrl: string;
}) {
  const channel = allowlistedVia(via);

  function track(action: string) {
    const payload = JSON.stringify({ action, via: channel });
    let queued = false;
    try {
      queued = navigator.sendBeacon(`/p/${slug}/click`, new Blob([payload], { type: "application/json" }));
    } catch {
      queued = false;
    }
    // Beacon false means the request was not queued. Fall back without keepalive on an active
    // page; never double-send when sendBeacon returns true.
    if (!queued) {
      void fetch(`/p/${slug}/click`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      }).catch(() => {});
    }
  }

  return (
    <div className="sc-public-actions">
      <a className="sc-primary" href={withVia(`/p/${slug}/vcard`, via)}>
        Save contact
      </a>
      {bookingUrl ? (
        <a className="sc-secondary" href={withVia(bookingUrl, via)}>
          Book a time
        </a>
      ) : null}
      <button
        type="button"
        className="sc-secondary"
        onClick={async () => {
          track("share");
          const url = `${window.location.origin}/p/${slug}`;
          try {
            if (navigator.share) {
              await navigator.share({ title: document.title, url });
            } else {
              await navigator.clipboard.writeText(url);
              track("copy_link");
            }
          } catch {
            /* user cancelled share */
          }
        }}
      >
        Share profile
      </button>
      <button
        type="button"
        className="sc-secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(`${window.location.origin}/p/${slug}`);
            track("copy_link");
          } catch {
            /* clipboard unavailable */
          }
        }}
      >
        Copy link
      </button>
    </div>
  );
}
