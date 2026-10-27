"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "./icons";
import { Modal } from "./modal";
type Connection = {
  account_sub: string;
  account_email: string;
  status: string;
  check_conflicts: boolean;
  sync_events: boolean;
  last_sync_at: string | null;
  last_error: string | null;
};
type Data = {
  configured: boolean;
  isAdmin: boolean;
  redirectUri: string;
  connections: Connection[];
  maximumAccounts: number;
  jobs: { pending: number; failed: number };
};
export function GoogleCalendarConnection() {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<Connection | null>(null);
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
        "Google account connected. Selected calendars are queued for appointment sync.",
      );
    if (result === "denied")
      setError(
        "Google authorization was cancelled. Existing accounts were kept.",
      );
    if (result === "failed")
      setError(
        "Google could not be connected. Check setup and permissions, then try again.",
      );
    if (result) {
      q.delete("google");
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (q.size ? "?" + q : ""),
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
      if (action === "check") {
        if (d.ok) setMessage(d.message);
        else setError(d.message);
        return;
      }
      setConfirm(null);
      setMessage(
        action === "disconnect"
          ? d.revocationConfirmed
            ? "Google account disconnected. Your other accounts are unchanged. Existing Google events remain."
            : "Disconnected in Zenvio. Remove Zenvio access in that Google account to finish revoking permissions."
          : action === "sync"
            ? `${d.delivered} booking updates processed across selected accounts. Check the pending count for remaining work.`
            : "Calendar preferences saved.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update calendars.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="google-connection">
      <div className="billing-section-heading">
        <div>
          <span className="billing-eyebrow">CONNECTED ACCOUNTS</span>
          <h2>
            <span className="google-mark" aria-hidden="true">
              G
            </span>{" "}
            Google Calendar
          </h2>
          <p>
            Connect up to five Google accounts. Choose each primary calendar for
            conflict checks and appointment copies.
          </p>
        </div>
        <span className="billing-badge">
          {data?.connections.length || 0} accounts
        </span>
      </div>
      {error && (
        <p role="alert" className="billing-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!data ? (
        <p>Loading calendar accounts…</p>
      ) : (
        <>
          <div className="billing-actions">
            <button
              disabled={
                busy ||
                !data.configured ||
                data.connections.length >= data.maximumAccounts
              }
              onClick={() => void action("connect")}
            >
              {busy
                ? "Working…"
                : data.connections.length
                  ? "Connect another Google account"
                  : "Connect Google Calendar"}
            </button>
            {data.connections.length > 0 && (
              <>
                <button
                  className="billing-secondary"
                  disabled={busy}
                  onClick={() => void action("sync")}
                >
                  Sync now / retry pending
                </button>
                <button
                  className="billing-secondary"
                  disabled={busy}
                  onClick={() => load().catch((e) => setError(e.message))}
                >
                  Refresh status
                </button>
              </>
            )}
          </div>
          {!data.configured && (
            <p className="billing-note">
              Google Calendar must first be configured by the platform
              administrator.{" "}
              {data.isAdmin && (
                <Link href="/admin/operations?section=integrations">
                  Admin setup →
                </Link>
              )}
            </p>
          )}
          {data.connections.length > 0 && (
            <p className="calendar-queue-status">
              {data.jobs.pending} booking updates pending · {data.jobs.failed}{" "}
              exhausted retries
            </p>
          )}
          <div className="google-account-list">
            {data.connections.map((c) => (
              <article className="google-account-card" key={c.account_sub}>
                <div className="billing-section-heading">
                  <div>
                    <h3>{c.account_email}</h3>
                    <p>
                      Primary calendar · Last sync:{" "}
                      {c.last_sync_at
                        ? new Date(c.last_sync_at).toLocaleString()
                        : "No updates yet"}
                    </p>
                  </div>
                  <span className="billing-badge">
                    {c.status === "connected"
                      ? "Connected"
                      : "Reconnect required"}
                  </span>
                </div>
                {c.last_error && <p className="billing-note">{c.last_error}</p>}
                <form
                  key={`${c.account_sub}:${c.check_conflicts}:${c.sync_events}`}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void action("settings", {
                      accountSub: c.account_sub,
                      checkConflicts: f.get("conflicts") === "on",
                      syncEvents: f.get("events") === "on",
                    });
                  }}
                >
                  <label className="market-checkbox">
                    <input
                      type="checkbox"
                      name="conflicts"
                      disabled={busy}
                      defaultChecked={c.check_conflicts}
                    />{" "}
                    Block busy times from this account
                  </label>
                  <label className="market-checkbox">
                    <input
                      type="checkbox"
                      name="events"
                      disabled={busy}
                      defaultChecked={c.sync_events}
                    />{" "}
                    Copy Zenvio bookings and cancellations to this calendar
                  </label>
                  <div className="billing-actions">
                    <button disabled={busy}>Save preferences</button>
                    <button
                      type="button"
                      className="billing-secondary"
                      disabled={busy}
                      onClick={() =>
                        void action("check", { accountSub: c.account_sub })
                      }
                    >
                      Check connection
                    </button>
                    <button
                      type="button"
                      className="billing-secondary"
                      disabled={busy}
                      onClick={() => void action("connect")}
                    >
                      Reconnect account
                    </button>
                    <button
                      type="button"
                      className="billing-secondary"
                      disabled={busy}
                      onClick={() => setConfirm(c)}
                    >
                      Disconnect account
                    </button>
                  </div>
                </form>
              </article>
            ))}
          </div>
          {!data.connections.length && (
            <ul className="google-feature-list">
              <li>
                <Icon name="check" size={16} /> Check availability across
                connected Google accounts
              </li>
              <li>
                <Icon name="check" size={16} /> Keep bookings on the calendars
                you choose
              </li>
              <li>
                <Icon name="check" size={16} /> Manage each account
                independently
              </li>
            </ul>
          )}
        </>
      )}
      <div className="google-sync-explainer">
        <h3>How multiple calendars work</h3>
        <p>
          Busy times from every enabled account are combined before guests
          choose or confirm a time. If an enabled account cannot be checked,
          booking availability pauses until access is restored or you disable
          its conflict checking.
        </p>
        <p>
          Bookings are copied to the primary calendar of each account with
          appointment copies enabled. New connections enable both options. If
          you only want one destination, turn off appointment copies on your
          other accounts. Each copy is tracked separately to prevent duplicates
          during retries.
        </p>
        <p>
          Turning off copies or disconnecting stops future updates for that
          account; existing Google events remain. Secondary and shared calendars
          within an account are not selectable in this release.
        </p>
        <p>
          Events include appointment title, location, guest name, and email;
          private notes stay in Zenvio. Manage appointment changes in Zenvio.
          Google edits do not reschedule or cancel a Zenvio appointment. Failed
          updates retry during activity and the daily retry task.
        </p>
      </div>
      {confirm && (
        <Modal
          title="Disconnect this Google account?"
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
        >
          <p>
            {confirm.account_email} will stop checking conflicts and receiving
            updates. Other connected accounts stay connected. Existing events
            remain in Google.
          </p>
          {error && <p role="alert">{error}</p>}
          <button
            disabled={busy}
            onClick={() =>
              void action("disconnect", { accountSub: confirm.account_sub })
            }
          >
            {busy ? "Disconnecting…" : "Confirm disconnect"}
          </button>
          <button
            className="billing-secondary"
            disabled={busy}
            onClick={() => setConfirm(null)}
          >
            Keep connected
          </button>
        </Modal>
      )}
    </section>
  );
}
