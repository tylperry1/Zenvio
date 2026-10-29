"use client";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, options: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id: string) => void;
    };
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

// Loads the public CAPTCHA site key; empty when the platform has none configured.
export function useCaptchaSiteKey() {
  const [siteKey, setSiteKey] = useState("");
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => setSiteKey(d.captchaSiteKey || ""))
      .catch(() => {});
  }, []);
  return siteKey;
}

export function Captcha({
  siteKey,
  onToken,
  resetKey,
}: {
  siteKey: string;
  onToken: (token: string) => void;
  resetKey?: unknown;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  useEffect(() => {
    if (!siteKey || !ref.current) return;
    let cancelled = false;
    const render = () => {
      if (cancelled || !ref.current || !window.turnstile || widget.current) return;
      widget.current = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        callback: (token: string) => onToken(token),
        "expired-callback": () => onToken(""),
        "error-callback": () => onToken(""),
      });
    };
    if (window.turnstile) render();
    else {
      let script = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
      if (!script) {
        script = document.createElement("script");
        script.src = SCRIPT;
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", render);
    }
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // A token is single-use; get a fresh one after a failed submission.
    if (widget.current && window.turnstile && resetKey) {
      window.turnstile.reset(widget.current);
      onToken("");
    }
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!siteKey) return null;
  return <div className="captcha" ref={ref} />;
}
