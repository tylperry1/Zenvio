"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "./icons";
import { Alert, Badge, Card, EmptyState, Skeleton, Toggle, formatDateTime, useConfirm } from "./ui";

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

export function GoogleCalendarConnection({ notify }: { notify: (text: string, error?: boolean) => void }) {
  const [data, setData] = useState<Data | null>(null),
    [loadError, setLoadError] = useState(""),
    [busy, setBusy] = useState(false);
  const { confirm, node: confirmNode } = useConfirm();
  async function load() {
    const r = await fetch("/api/calendars/google", { cache: "no-store" }),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    setData(d);
  }
  useEffect(() => {
    load().catch((e) => setLoadError(e.message));
    const q = new URLSearchParams(window.location.search),
      result = q.get("google");
    if (result === "connected") notify("Google account connected. Your calendar is being synced.");
    if (result === "denied") notify("Google authorization was cancelled. Existing accounts were kept.", true);
    if (result === "failed") notify("Google couldn’t be connected. Check permissions and try again.", true);
    if (result) {
      q.delete("google");
      window.history.replaceState(null, "", window.location.pathname + (q.size ? "?" + q : ""));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function action(action: string, values: Record<string, unknown> = {}) {
    setBusy(true);
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
      if (action === "check") return notify(d.message, !d.ok);
      notify(
        action === "disconnect"
          ? d.revocationConfirmed
            ? "Google account disconnected. Existing Google events were kept."
            : "Disconnected in Zenvio. Remove Zenvio’s access in that Google account to finish revoking it."
          : action === "sync"
            ? `${d.delivered} calendar update${d.delivered === 1 ? "" : "s"} sent to Google.`
            : "Calendar preferences saved.",
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : "Unable to update calendars.", true);
    } finally {
      setBusy(false);
    }
  }
  const full = data ? data.connections.length >= data.maximumAccounts : false;
  return (
    <Card
      title={
        <span className="gc-title">
          <span className="gc-mark" aria-hidden="true">
            G
          </span>
          Google Calendar
        </span>
      }
      description="Zenvio hides times you’re busy in Google and copies new bookings to your calendar."
      actions={
        data && (
          <>
            {data.connections.length > 0 && (
              <button className="ui-btn ui-btn-ghost" disabled={busy} onClick={() => void action("sync")}>
                Sync now
              </button>
            )}
            <button
              className="ui-btn ui-btn-primary"
              disabled={busy || !data.configured || full}
              onClick={() => void action("connect")}
            >
              <Icon name="plus" size={15} />
              {data.connections.length ? "Add account" : "Connect Google"}
            </button>
          </>
        )
      }
      flush
    >
      {loadError && (
        <div className="ui-card-body">
          <Alert tone="danger">{loadError}</Alert>
        </div>
      )}
      {!data && !loadError && <Skeleton rows={2} />}
      {data && !data.configured && (
        <div className="ui-card-body">
          <Alert tone="info" title="Google Calendar isn’t available yet">
            The platform administrator needs to finish Google setup first.{" "}
            {data.isAdmin && <Link href="/admin/operations?section=integrations">Open admin setup</Link>}
          </Alert>
        </div>
      )}
      {data && data.configured && !data.connections.length && (
        <EmptyState icon="calendar" title="No Google accounts connected">
          Connect up to {data.maximumAccounts} Google accounts. Busy times from all of them are combined before guests
          see open slots.
        </EmptyState>
      )}
      {data && data.connections.length > 0 && (
        <>
          <ul className="ui-list">
            {data.connections.map((c) => {
              const ok = c.status === "connected";
              return (
                <li key={c.account_sub} className="gc-account">
                  <span className="ui-list-icon">
                    <Icon name="calendar" size={16} />
                  </span>
                  <div className="ui-list-main">
                    <b>{c.account_email}</b>
                    <small>
                      Primary calendar · {c.last_sync_at ? `last synced ${formatDateTime(c.last_sync_at)}` : "not synced yet"}
                    </small>
                    {c.last_error && <small className="pay-error">{c.last_error}</small>}
                    <div className="gc-prefs">
                      <label>
                        <Toggle
                          label="Block busy times from this account"
                          checked={c.check_conflicts}
                          disabled={busy}
                          onChange={(next) =>
                            void action("settings", {
                              accountSub: c.account_sub,
                              checkConflicts: next,
                              syncEvents: c.sync_events,
                            })
                          }
                        />
                        Block busy times
                      </label>
                      <label>
                        <Toggle
                          label="Copy bookings to this calendar"
                          checked={c.sync_events}
                          disabled={busy}
                          onChange={(next) =>
                            void action("settings", {
                              accountSub: c.account_sub,
                              checkConflicts: c.check_conflicts,
                              syncEvents: next,
                            })
                          }
                        />
                        Copy bookings here
                      </label>
                    </div>
                  </div>
                  <Badge tone={ok ? "success" : "warning"}>{ok ? "Connected" : "Reconnect needed"}</Badge>
                  <div className="gc-actions">
                    <button
                      className="ui-btn ui-btn-ghost ui-btn-sm"
                      disabled={busy}
                      onClick={() => void action("check", { accountSub: c.account_sub })}
                    >
                      Test
                    </button>
                    {!ok && (
                      <button className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy} onClick={() => void action("connect")}>
                        Reconnect
                      </button>
                    )}
                    <button
                      className="ui-btn ui-btn-ghost ui-btn-sm"
                      disabled={busy}
                      onClick={async () => {
                        if (
                          await confirm({
                            title: "Disconnect this Google account?",
                            body: `${c.account_email} will stop blocking busy times and receiving new bookings. Existing events stay in Google; your other accounts aren’t affected.`,
                            confirmLabel: "Disconnect",
                            danger: true,
                          })
                        )
                          void action("disconnect", { accountSub: c.account_sub });
                      }}
                    >
                      Disconnect
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {(data.jobs.pending > 0 || data.jobs.failed > 0) && (
            <div className="ui-card-foot gc-queue">
              <span>
                {data.jobs.pending} update{data.jobs.pending === 1 ? "" : "s"} waiting to sync
                {data.jobs.failed > 0 && ` · ${data.jobs.failed} failed after retries`}
              </span>
            </div>
          )}
        </>
      )}
      <details className="gc-details">
        <summary>How syncing works</summary>
        <ul>
          <li>Busy times from every account with blocking on are combined before guests choose a time. If one can’t be checked, booking pauses until access is restored or blocking is turned off.</li>
          <li>Bookings are copied to the primary calendar of each account with copying on. Turn copying off on accounts you don’t want to fill up.</li>
          <li>Events include the title, location, guest name, and email. Private notes stay in Zenvio.</li>
          <li>Make changes in Zenvio — editing or deleting the Google event doesn’t change the appointment.</li>
          <li>Disconnecting stops future updates; events already in Google stay there.</li>
        </ul>
      </details>
      {confirmNode}
    </Card>
  );
}
