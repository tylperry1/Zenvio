"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "./app-shell";
import { Notice } from "./ds";

type Prefs = {
  emailReminders: boolean;
  emailMessages: boolean;
  emailDocuments: boolean;
  emailPayments: boolean;
  emailMarketing: boolean;
  pushBookings: boolean;
  pushMessages: boolean;
  pushSupport: boolean;
  autoConfirmations: boolean;
  autoReminders: boolean;
  autoFollowups: boolean;
};

const defaults: Prefs = {
  emailReminders: true,
  emailMessages: true,
  emailDocuments: true,
  emailPayments: true,
  emailMarketing: false,
  pushBookings: true,
  pushMessages: true,
  pushSupport: true,
  autoConfirmations: true,
  autoReminders: true,
  autoFollowups: false,
};

const STORAGE_KEY = "zenvio-notification-prefs";

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

export function NotificationsCenter() {
  const [prefs, setPrefs] = useState<Prefs>(defaults);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPrefs(readPrefs());
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  function update<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* private mode */
      }
      return next;
    });
  }

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
      setMessage("Browser notifications are enabled for this device.");
      new Notification("Zenvio notifications ready", {
        body: "You’ll get alerts for bookings, messages, and support when this browser is open.",
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
        title="Notifications"
        description="Choose email, browser push, and automatic customer notifications. Security and billing emails always send."
      />
      {error && <Notice tone="danger">{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}

      <section className="notif-card">
        <header>
          <h2>Browser push</h2>
          <p>Get alerts on this device while you’re signed in. Uses the existing Zenvio service worker.</p>
        </header>
        <p className="notif-status">
          Status:{" "}
          <strong>
            {permission === "unsupported"
              ? "Not supported"
              : permission === "granted"
                ? "Enabled"
                : permission === "denied"
                  ? "Blocked in browser settings"
                  : "Not enabled yet"}
          </strong>
        </p>
        <div className="notif-toggles">
          <label>
            <input type="checkbox" checked={prefs.pushBookings} onChange={(e) => update("pushBookings", e.target.checked)} />
            Booking and reminder alerts
          </label>
          <label>
            <input type="checkbox" checked={prefs.pushMessages} onChange={(e) => update("pushMessages", e.target.checked)} />
            Client message alerts
          </label>
          <label>
            <input type="checkbox" checked={prefs.pushSupport} onChange={(e) => update("pushSupport", e.target.checked)} />
            Support inbox alerts
          </label>
        </div>
        <button className="ui-btn ui-btn-primary" disabled={busy || permission === "unsupported" || permission === "granted"} onClick={() => void enablePush()}>
          {permission === "granted" ? "Push enabled" : busy ? "Enabling…" : "Enable browser notifications"}
        </button>
      </section>

      <section className="notif-card">
        <header>
          <h2>Email notifications</h2>
          <p>Transactional emails use the platform email system. Marketing mail stays opt-in.</p>
        </header>
        <div className="notif-toggles">
          <label>
            <input type="checkbox" checked={prefs.emailReminders} onChange={(e) => update("emailReminders", e.target.checked)} />
            Appointment reminders
          </label>
          <label>
            <input type="checkbox" checked={prefs.emailMessages} onChange={(e) => update("emailMessages", e.target.checked)} />
            Client messages
          </label>
          <label>
            <input type="checkbox" checked={prefs.emailDocuments} onChange={(e) => update("emailDocuments", e.target.checked)} />
            Documents and signatures
          </label>
          <label>
            <input type="checkbox" checked={prefs.emailPayments} onChange={(e) => update("emailPayments", e.target.checked)} />
            Payments and invoices
          </label>
          <label>
            <input type="checkbox" checked={prefs.emailMarketing} onChange={(e) => update("emailMarketing", e.target.checked)} />
            Growth and marketing updates
          </label>
        </div>
      </section>

      <section className="notif-card">
        <header>
          <h2>Automatic customer notifications</h2>
          <p>These control the automatic emails your clients receive through existing booking and workflow systems.</p>
        </header>
        <div className="notif-toggles">
          <label>
            <input type="checkbox" checked={prefs.autoConfirmations} onChange={(e) => update("autoConfirmations", e.target.checked)} />
            Send booking confirmations automatically
          </label>
          <label>
            <input type="checkbox" checked={prefs.autoReminders} onChange={(e) => update("autoReminders", e.target.checked)} />
            Send appointment reminders automatically
          </label>
          <label>
            <input type="checkbox" checked={prefs.autoFollowups} onChange={(e) => update("autoFollowups", e.target.checked)} />
            Send follow-up / review requests from automations
          </label>
        </div>
        <p className="notif-note">
          Reminder timing still lives on each booking link under Automations. Changes here are remembered on this device and guide the workspace controls; delivery continues through the existing Resend lifecycle queue.
        </p>
        <a className="ui-btn ui-btn-secondary" href="/app/automation">
          Open Automations
        </a>
      </section>
    </main>
  );
}
