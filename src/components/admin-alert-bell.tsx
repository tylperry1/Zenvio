"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { relativeTime } from "./ds";

type Alert = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string;
  read_at: string | null;
  created_at: string;
};

type Badges = {
  support: number;
  feedback: number;
  alertsUnread: number;
  vapidPublicKey: string | null;
};

async function post(action: string, payload: Record<string, unknown> = {}) {
  const r = await fetch("/api/admin/alerts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Request failed.");
  return d;
}

/** Registers this browser for Web Push. Returns true only after a successful subscription save. */
async function ensureDevicePush(vapidPublicKey: string | null): Promise<boolean> {
  if (!vapidPublicKey || typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  if (typeof Notification === "undefined") return false;
  if (Notification.permission !== "granted") return false;
  await navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => null);
  // Wait for an active worker — subscribe() rejects with InvalidStateError otherwise.
  const ready = await navigator.serviceWorker.ready.catch(() => null);
  if (!ready) return false;
  const existing = await ready.pushManager.getSubscription();
  const subscription =
    existing ||
    (await ready.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }));
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
  await post("push-subscribe", {
    subscription: { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } },
  });
  return true;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function useAdminBadges(enabled: boolean) {
  const [badges, setBadges] = useState<Badges>({
    support: 0,
    feedback: 0,
    alertsUnread: 0,
    vapidPublicKey: null,
  });
  const load = useCallback(() => {
    if (!enabled) return;
    fetch("/api/admin/alerts?view=badges", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setBadges({
          support: Number(d.support) || 0,
          feedback: Number(d.feedback) || 0,
          alertsUnread: Number(d.alertsUnread) || 0,
          vapidPublicKey: d.vapidPublicKey || null,
        });
      })
      .catch(() => {});
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    void load();
    const timer = window.setInterval(() => document.visibilityState === "visible" && void load(), 20000);
    return () => window.clearInterval(timer);
  }, [enabled, load]);
  return { badges, refresh: load };
}

export function AdminAlertBell({ enabled = true }: { enabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [unread, setUnread] = useState(0);
  const [vapid, setVapid] = useState<string | null>(null);
  const [pushState, setPushState] = useState<"unknown" | "off" | "on" | "unsupported">("unknown");
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    const r = await fetch("/api/admin/alerts", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return;
    setAlerts(d.alerts || []);
    setUnread(Number(d.unread) || 0);
    setVapid(d.vapidPublicKey || null);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void load();
    const timer = window.setInterval(() => document.visibilityState === "visible" && void load(), 25000);
    return () => window.clearInterval(timer);
  }, [enabled, load]);

  useEffect(() => {
    if (typeof Notification === "undefined" || !("PushManager" in window)) {
      setPushState("unsupported");
      return;
    }
    // Permission alone is not registration — stay "off" until subscribe succeeds.
    if (Notification.permission !== "granted") {
      setPushState("off");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration("/");
        const sub = await reg?.pushManager.getSubscription();
        if (!cancelled) setPushState(sub ? "on" : "off");
      } catch {
        if (!cancelled) setPushState("off");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vapid]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function enablePush() {
    setError("");
    try {
      if (typeof Notification === "undefined") throw new Error("Notifications aren’t supported here.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notification permission wasn’t granted.");
      const ok = await ensureDevicePush(vapid);
      if (!ok) throw new Error("Couldn’t register this device for push. Try again.");
      setPushState("on");
      new Notification("Zenvio platform alerts ready", {
        body: "Support, feedback, and other platform alerts will reach this device.",
        icon: "/brand/icon-192.png",
        tag: "zenvio-push-ready",
      });
    } catch (e) {
      setPushState("off");
      setError(e instanceof Error ? e.message : "Unable to enable device alerts.");
    }
  }

  async function markAllRead() {
    await post("read");
    setUnread(0);
    setAlerts((list) => list.map((a) => ({ ...a, read_at: a.read_at || new Date().toISOString() })));
  }

  if (!enabled) return null;

  return (
    <div className="acx-alert-bell" ref={root}>
      <button
        type="button"
        className="acx-bell-btn"
        aria-label={unread ? `${unread} unread platform alerts` : "Platform alerts"}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void load();
        }}
      >
        <Icon name="bell" size={16} />
        {unread > 0 && <span className="acx-bell-count">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="acx-bell-panel" role="dialog" aria-label="Platform alerts">
          <header>
            <strong>Platform alerts</strong>
            <div className="acx-bell-actions">
              {unread > 0 && (
                <button type="button" onClick={() => void markAllRead()}>
                  Mark all read
                </button>
              )}
              {pushState === "off" && (
                <button type="button" onClick={() => void enablePush()}>
                  Enable device push
                </button>
              )}
              {pushState === "on" && <span className="acx-bell-push-on">Device push on</span>}
            </div>
          </header>
          {error && <p className="acx-bell-error">{error}</p>}
          {alerts.length === 0 ? (
            <p className="acx-bell-empty">No alerts yet. New support and feedback activity appears here and on your devices.</p>
          ) : (
            <ul>
              {alerts.map((a) => (
                <li key={a.id} className={a.read_at ? "" : "unread"}>
                  {a.href ? (
                    <Link
                      href={a.href}
                      onClick={() => {
                        void post("read", { ids: [a.id] });
                        setOpen(false);
                      }}
                    >
                      <b>{a.title}</b>
                      {a.body && <span>{a.body}</span>}
                      <small>{relativeTime(a.created_at)}</small>
                    </Link>
                  ) : (
                    <div>
                      <b>{a.title}</b>
                      {a.body && <span>{a.body}</span>}
                      <small>{relativeTime(a.created_at)}</small>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
