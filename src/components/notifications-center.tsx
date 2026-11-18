"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "./app-shell";
import { Notice } from "./ds";

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

  return (
    <main className="platform-page notifications-page">
      <PageHeader
        title="Browser alerts"
        description="Control browser alerts on this device. Email and SMS for bookings are managed separately under Automations and your services."
      />
      {error && <Notice tone="danger">{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}

      <section className="notif-card">
        <header>
          <h2>Browser notifications</h2>
          <p>
            Asks this browser for permission so Zenvio can show alerts while the app is open on this device.
          </p>
        </header>
        <p className="notif-status">
          Status:{" "}
          <strong>
            {permission === "unsupported"
              ? "Not supported"
              : permission === "granted"
                ? "Permission granted on this device"
                : permission === "denied"
                  ? "Blocked in browser settings"
                  : "Not enabled yet"}
          </strong>
        </p>
        <button className="ui-btn ui-btn-primary" disabled={busy || permission === "unsupported" || permission === "granted"} onClick={() => void enablePush()}>
          {permission === "granted" ? "Permission granted" : busy ? "Enabling…" : "Enable browser notifications"}
        </button>
      </section>

      <section className="notif-card">
        <header>
          <h2>Customer email & SMS</h2>
          <p>
            Booking confirmations, reminders, and follow-ups are sent by email and SMS through Automations and your
            service settings. Those channels are separate from this browser permission.
          </p>
        </header>
        <p className="notif-note">
          Security, billing, and account emails always send. Marketing email stays opt-in. Phone alerts use your
          Automations and messaging settings—not this browser switch.
        </p>
        <div className="notif-actions">
          <Link className="ui-btn ui-btn-primary" href="/app/automation">
            Open Automations
          </Link>
          <Link className="ui-btn ui-btn-secondary" href="/app?view=event-types">
            Services & reminders
          </Link>
        </div>
      </section>

      <section className="notif-card">
        <header>
          <h2>In-app alerts</h2>
          <p>Support and inbox activity continue to surface in the workspace. Use Support and Inbox for live conversations.</p>
        </header>
        <div className="notif-actions">
          <Link className="ui-btn ui-btn-secondary" href="/app/inbox">
            Open Inbox
          </Link>
          <Link className="ui-btn ui-btn-secondary" href="/app/support">
            Open Support
          </Link>
        </div>
      </section>
    </main>
  );
}
