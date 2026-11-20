"use client";

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
  function track(action: string) {
    const payload = JSON.stringify({ action, via: via || "" });
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

  return (
    <div className="sc-public-actions">
      <a className="sc-primary" href={`/p/${slug}/vcard`}>
        Save contact
      </a>
      {bookingUrl ? (
        <a className="sc-secondary" href={bookingUrl}>
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
