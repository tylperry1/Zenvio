"use client";
import { useEffect, useState } from "react";
import { Icon } from "./icons";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const DISMISS_KEY = "zenvio.install.dismissed";

/** Registers the static-asset service worker in production builds only. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* Installability is optional; the site works without it. */
    });
  }, []);
  return null;
}

function standalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
function dismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Small, dismissible install card for phones and tablets inside the workspace. */
export function InstallPrompt() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (standalone() || dismissed() || window.innerWidth > 1024) return;
    const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) && !/CriOS|FxiOS/.test(navigator.userAgent);
    if (isIos) {
      setIos(true);
      setOpen(true);
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
      setOpen(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  function dismiss() {
    setOpen(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* Private mode: the card simply reappears next visit. */
    }
  }

  if (!open) return null;
  return (
    <aside className="pwa-install" role="dialog" aria-label="Install Zenvio">
      <img src="/brand/icon-192.png" alt="" width={40} height={40} />
      <div>
        <b>Add Zenvio to your home screen</b>
        {ios ? (
          <p>
            Tap <span className="pwa-share" aria-label="Share">Share</span> then “Add to Home Screen” for one-tap access.
          </p>
        ) : (
          <p>Open your calendar, inbox and clients like an app.</p>
        )}
      </div>
      {event && (
        <button
          className="pwa-install-btn"
          onClick={async () => {
            await event.prompt();
            await event.userChoice.catch(() => null);
            setEvent(null);
            dismiss();
          }}
        >
          Install
        </button>
      )}
      <button className="pwa-close" onClick={dismiss} aria-label="Dismiss install suggestion">
        <Icon name="close" size={16} />
      </button>
    </aside>
  );
}
