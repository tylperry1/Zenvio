"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "./icons";
import { Modal } from "./modal";
type Data = {
  configured: boolean;
  isAdmin: boolean;
  redirectUri: string;
  connection: {
    account_email: string;
    status: string;
    check_conflicts: boolean;
    sync_events: boolean;
    last_sync_at: string | null;
    last_error: string | null;
  } | null;
  jobs: { pending: number; failed: number };
};
export function GoogleCalendarConnection() {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  async function load() {
    const r = await fetch("/api/calendars/google", { cache: "no-store" }),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    setData(d);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
    const q = new URLSearchParams(window.location.search),
      result = q.get("google");
    if (result === "connected")
      setMessage(
        "Google Calendar connected. Upcoming appointments have been queued for sync.",
      );
    if (result === "denied")
      setError(
        "Google authorization was cancelled. Your existing calendar connection was not changed.",
      );
    if (result === "failed")
      setError(
        "Google Calendar could not be connected. Check setup and permissions, then try again.",
      );
    if (result) {
      q.delete("google");
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (q.size ? "?" + q.toString() : ""),
      );
    }
  }, []);
  async function action(action: string, values: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/calendars/google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...values }),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (d.url) {
        window.location.assign(d.url);
        return;
      }
      await load();
      setConfirm(false);
      setMessage(
        action === "disconnect"
          ? d.revocationConfirmed
            ? "Google Calendar disconnected. Existing Google events have been kept."
            : "Disconnected in Zenvio. Google access could not be revoked automatically; remove Zenvio in your Google account permissions."
          : action === "sync"
            ? `${d.delivered} calendar updates delivered. Refresh status to check any remaining updates.`
            : "Calendar settings saved successfully.",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to update Google Calendar.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="google-connection">
      <div className="billing-section-heading">
        <div>
          <span className="billing-eyebrow">DIRECT CALENDAR SYNC</span>
          <h2>
            <span className="google-mark" aria-hidden="true">
              G
            </span>{" "}
            Google Calendar
          </h2>
          <p>
            Check your primary calendar for conflicts and keep Zenvio
            appointments on your calendar.
          </p>
        </div>
        <span className="billing-badge">
          {data?.connection
            ? data.connection.status === "connected"
              ? "Connected"
              : "Reconnect required"
            : "Not connected"}
        </span>
      </div>
      {error && (
        <p role="alert" className="billing-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!data ? (
        <p>Loading calendar connection…</p>
      ) : data.connection ? (
        <>
          <div className="billing-detail-grid">
            <div>
              <small>Google account</small>
              <b>{data.connection.account_email}</b>
            </div>
            <div>
              <small>Calendar</small>
              <b>Primary calendar</b>
            </div>
            <div>
              <small>Last appointment sync</small>
              <b>
                {data.connection.last_sync_at
                  ? new Date(data.connection.last_sync_at).toLocaleString()
                  : "Waiting for first update"}
              </b>
            </div>
            <div>
              <small>Updates pending / exhausted retries</small>
              <b>
                {data.jobs.pending} / {data.jobs.failed}
              </b>
            </div>
          </div>
          {data.connection.last_error && (
            <p className="billing-note">{data.connection.last_error}</p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action("settings", {
                checkConflicts: f.get("conflicts") === "on",
                syncEvents: f.get("events") === "on",
              });
            }}
          >
            <label className="market-checkbox">
              <input
                type="checkbox"
                name="conflicts"
                defaultChecked={data.connection.check_conflicts}
                key={"busy" + String(data.connection.check_conflicts)}
              />{" "}
              Block busy times from my Google Calendar
            </label>
            <label className="market-checkbox">
              <input
                type="checkbox"
                name="events"
                defaultChecked={data.connection.sync_events}
                key={"events" + String(data.connection.sync_events)}
              />{" "}
              Send bookings and cancellations to my Google Calendar
            </label>
            <div className="billing-actions">
              <button disabled={busy}>Save preferences</button>
              <button
                type="button"
                className="billing-secondary"
                disabled={busy || data.connection.status !== "connected"}
                onClick={() => void action("sync")}
              >
                {busy ? "Working…" : "Sync now / retry pending"}
              </button>
              <button
                type="button"
                className="billing-secondary"
                disabled={busy}
                onClick={() => load().catch((e) => setError(e.message))}
              >
                Refresh status
              </button>
            </div>
          </form>
          <div className="billing-actions">
            <button
              className="billing-secondary"
              disabled={busy}
              onClick={() => void action("connect")}
            >
              Reconnect Google account
            </button>
            <button
              className="billing-secondary"
              disabled={busy}
              onClick={() => setConfirm(true)}
            >
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <ul className="google-feature-list">
            <li>
              <Icon name="check" size={16} /> Fresh conflict checks when guests
              view times and confirm bookings
            </li>
            <li>
              <Icon name="check" size={16} /> New appointments and cancellations
              sent to Google
            </li>
            <li>
              <Icon name="check" size={16} /> Encrypted access tokens and a
              revocable connection
            </li>
          </ul>
          <button
            disabled={busy || !data.configured}
            onClick={() => void action("connect")}
          >
            {busy ? "Opening Google…" : "Connect Google Calendar"}
          </button>
          {!data.configured && (
            <p className="billing-note">
              Google Calendar must first be configured by the platform
              administrator in Integrations.{" "}
              {data.isAdmin && (
                <Link href="/admin/operations?section=integrations">
                  Admin setup →
                </Link>
              )}
            </p>
          )}
        </>
      )}
      <div className="google-sync-explainer">
        <h3>How synchronization works</h3>
        <p>
          Busy periods are checked against Google when choosing a time and again
          before a booking is confirmed. If Google is temporarily unavailable,
          connected conflict checks pause booking availability until it
          recovers.
        </p>
        <p>
          Zenvio copies the appointment title, location, guest name, and email
          to your primary calendar. Private booking notes stay in Zenvio. Only
          events created by this connection are updated or removed.
        </p>
        <p>
          Manage appointment changes in Zenvio. Editing or deleting an event in
          Google does not cancel or reschedule the Zenvio appointment. Calendar
          changes made elsewhere at the same moment as a booking can still
          require review.
        </p>
        <p>
          Bookings are queued for delivery after changes. Failed updates retry
          during activity and the daily retry task; you can also use Sync now. A
          pending count means delivery is not complete.
        </p>
      </div>
      {confirm && (
        <Modal
          title="Disconnect Google Calendar?"
          onClose={() => {
            if (!busy) setConfirm(false);
          }}
        >
          <p>
            Future conflict checks and appointment updates will stop. Existing
            Google events will remain on your calendar.
          </p>
          {error && (
            <p role="alert" className="billing-error">
              {error}
            </p>
          )}
          <button disabled={busy} onClick={() => void action("disconnect")}>
            {busy ? "Disconnecting…" : "Confirm disconnect"}
          </button>
          <button
            className="billing-secondary"
            disabled={busy}
            onClick={() => setConfirm(false)}
          >
            Keep connected
          </button>
        </Modal>
      )}
    </section>
  );
}
