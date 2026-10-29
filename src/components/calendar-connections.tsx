"use client";
import { PageHeader } from "./app-shell";
import { GoogleCalendarConnection } from "./google-calendar-connection";
import { useEffect, useState } from "react";
export function CalendarConnections() {
  const [token, setToken] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const r = await fetch("/api/calendars", { cache: "no-store" }),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    setToken(d.feed?.token || "");
  }
  useEffect(() => {
    load().catch((e) => setMessage(e.message));
  }, []);
  async function action(action: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/calendars", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      await load();
      setMessage(
        action === "disconnect"
          ? "Calendar feed disconnected."
          : "Calendar feed updated successfully.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to update calendar.");
    } finally {
      setBusy(false);
    }
  }
  const url =
    typeof window !== "undefined" && token
      ? `${window.location.origin}/api/calendars/feed?token=${token}`
      : "";
  return (
    <div className="platform-page">
      <main className="narrow-page">
        <PageHeader
          title="Calendar connections"
          description="Connect external calendars for conflict checks, or subscribe to a private feed of your Zenvio appointments."
        />
        <GoogleCalendarConnection />
        <section>
          <h2>Calendar subscription feed</h2>
          <p>
            Subscribe to your private Zenvio feed in Google Calendar, Outlook,
            or Apple Calendar. New and cancelled appointments appear when your
            calendar refreshes the feed.
          </p>
          <p>
            This feed is one-way from Zenvio. It does not check external
            conflicts. Use the direct Google connection above for busy-time
            conflict checks. Your calendar provider controls feed refresh
            timing.
          </p>
          {message && <p role="status">{message}</p>}
          {token ? (
            <>
              <label>
                Private calendar URL
                <input
                  readOnly
                  value={url}
                  style={{ width: "100%", padding: 12 }}
                />
              </label>
              <p>
                Anyone with this link can view appointment titles, times, and
                locations. Keep it private.
              </p>
              <button
                onClick={() =>
                  navigator.clipboard
                    .writeText(url)
                    .then(() => setMessage("Calendar URL copied."))
                    .catch(() => setMessage("Copy the URL above."))
                }
              >
                Copy URL
              </button>
              <button disabled={busy} onClick={() => void action("rotate")}>
                Replace private link
              </button>
              <button disabled={busy} onClick={() => void action("disconnect")}>
                Disconnect feed
              </button>
              <ol>
                <li>Copy your private calendar URL.</li>
                <li>
                  In Google Calendar choose Other calendars → From URL. In
                  Outlook choose Add calendar → Subscribe from web.
                </li>
                <li>
                  Paste the URL and subscribe. Replacing or disconnecting the
                  link stops future refreshes from that URL.
                </li>
              </ol>
            </>
          ) : (
            <button disabled={busy} onClick={() => void action("connect")}>
              Create private calendar feed
            </button>
          )}
        </section>
      </main>
    </div>
  );
}
