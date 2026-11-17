"use client";

import { useEffect, useState } from "react";
import { GoogleCalendarConnection } from "./google-calendar-connection";
import { VideoMeetings } from "./video-meetings";
import { Icon } from "./icons";
import { EmptyState, Notice, PageHeader, Panel, Skeleton } from "./ds";
import { CopyField, useConfirm, useToast } from "./ui";

export function CalendarConnections() {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  const { confirm, node: confirmNode } = useConfirm();

  async function load() {
    const r = await fetch("/api/calendars", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    setToken(d.feed?.token || "");
  }

  useEffect(() => {
    load().catch((e) => {
      setError(e.message);
      toast.show(e.message, true);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function action(actionName: string, success: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/calendars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionName }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      await load();
      toast.show(success);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Unable to update calendar.", true);
    } finally {
      setBusy(false);
    }
  }

  const url = typeof window !== "undefined" && token ? `${window.location.origin}/api/calendars/feed?token=${token}` : "";

  return (
    <div className="ds-root platform-page connections-page">
      <PageHeader
        title="Calendar connections"
        description="Connect Google Calendar to avoid double-booking, or subscribe to your appointments from any calendar app."
      />
      {error && <Notice tone="danger">{error}</Notice>}

      <div className="ds-stack">
        <GoogleCalendarConnection notify={toast.show} />

        <Panel
          title="Calendar feed"
          description="A private, read-only link to your Zenvio appointments for Outlook, Apple Calendar, or any app that subscribes to calendars. It doesn’t check for conflicts."
          actions={
            token ? (
              <>
                <button
                  className="ds-btn ghost sm"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: "Replace your feed link?",
                        body: "The current link stops updating. You’ll need to subscribe again with the new one.",
                        confirmLabel: "Replace link",
                      })
                    )
                      void action("rotate", "New feed link created.");
                  }}
                >
                  Replace link
                </button>
                <button
                  className="ds-btn ghost sm"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: "Turn off your calendar feed?",
                        body: "Calendars subscribed to this link stop receiving updates.",
                        confirmLabel: "Turn off feed",
                        danger: true,
                      })
                    )
                      void action("disconnect", "Calendar feed turned off.");
                  }}
                >
                  Turn off
                </button>
              </>
            ) : null
          }
        >
          {token === null ? (
            <Skeleton />
          ) : token ? (
            <div className="ds-stack">
              <CopyField label="Private calendar link" value={url} />
              <p className="ds-muted">
                Anyone with this link can see your appointment titles, times, and locations — keep it private.
              </p>
              <ol className="ds-plain-list">
                <li>
                  <b>Outlook:</b> Add calendar → Subscribe from web, then paste the link.
                </li>
                <li>
                  <b>Apple Calendar:</b> File → New Calendar Subscription, then paste the link.
                </li>
                <li>
                  <b>Google Calendar:</b> Other calendars → From URL. (Connecting Google above is faster and checks
                  conflicts.)
                </li>
              </ol>
            </div>
          ) : (
            <EmptyState
              icon="calendar"
              title="No feed yet"
              action={
                <button className="ds-btn primary" disabled={busy} onClick={() => void action("connect", "Calendar feed created.")}>
                  <Icon name="plus" size={15} /> Create feed link
                </button>
              }
            >
              Create a private link, then subscribe to it from your calendar app.
            </EmptyState>
          )}
        </Panel>

        <VideoMeetings />
      </div>
      {confirmNode}
      {toast.node}
    </div>
  );
}
