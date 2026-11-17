"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "./app-shell";
import { Badge, Notice, Panel } from "./ds";

export function NotificationsCenter() {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  async function enablePush() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (typeof Notification === "undefined") throw Error("Desktop notifications aren’t supported in this browser.");
      const next = await Notification.requestPermission();
      setPermission(next);
      if (next !== "granted") throw Error("Notification permission wasn’t granted.");
      if ("serviceWorker" in navigator) {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => null);
      }
      setMessage("Browser notifications are enabled on this device while this browser is open.");
      new Notification("Zenvio notifications ready", {
        body: "You’ll get a test alert on this device. Booking and support alerts use this browser permission when the app shows them.",
        icon: "/brand/favicon-32.png",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to enable notifications.");
    } finally {
      setBusy(false);
    }
  }

  const statusLabel =
    permission === "unsupported"
      ? "Not supported"
      : permission === "granted"
        ? "Permission granted"
        : permission === "denied"
          ? "Blocked in browser settings"
          : "Not enabled yet";
  const statusTone =
    permission === "granted" ? "success" : permission === "denied" || permission === "unsupported" ? "warning" : "neutral";

  return (
    <main className="ds-root platform-page notifications-page">
      <PageHeader
        title="Browser alerts"
        description="Control browser alerts on this device. Email and SMS for bookings are managed separately under Automations and your services."
      />
      {error && <Notice tone="danger">{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}

      <div className="ds-stack">
        <Panel
          title="Browser notifications"
          description="Asks this browser for permission so Zenvio can show alerts while the app is open on this device."
          actions={<Badge tone={statusTone} dot>{statusLabel}</Badge>}
        >
          <button
            className="ds-btn primary"
            disabled={busy || permission === "unsupported" || permission === "granted"}
            onClick={() => void enablePush()}
          >
            {permission === "granted" ? "Permission granted" : busy ? "Enabling…" : "Enable browser notifications"}
          </button>
        </Panel>

        <Panel
          title="Customer email & SMS"
          description="Manage booking email and, where available, SMS in Automations and your service settings. Those channels are separate from this browser permission."
        >
          <p className="ds-muted">
            Security, billing, and account emails send when email delivery is available. Marketing email stays opt-in.
            Phone alerts use your Automations and messaging settings—not this browser switch.
          </p>
          <div className="ds-form-actions" style={{ justifyContent: "flex-start" }}>
            <Link className="ds-btn primary" href="/app/automation">
              Open Automations
            </Link>
            <Link className="ds-btn" href="/app?view=event-types">
              Services & reminders
            </Link>
          </div>
        </Panel>

        <Panel title="In-app alerts" description="Support and inbox activity continue to surface in the workspace.">
          <div className="ds-form-actions" style={{ justifyContent: "flex-start" }}>
            <Link className="ds-btn" href="/app/inbox">
              Open Inbox
            </Link>
            <Link className="ds-btn" href="/app/support">
              Open Support
            </Link>
          </div>
        </Panel>
      </div>
    </main>
  );
}
