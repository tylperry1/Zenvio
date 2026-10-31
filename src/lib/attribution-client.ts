"use client";
// Captures where a booking-page visitor came from, once per browser session per
// business. Only the source tag, campaign and referring site are kept, in
// sessionStorage, and sent with the booking. No cookies or identifiers.
export type ClientAttribution = { source?: string; medium?: string; campaign?: string; referrer?: string };
const key = (host: string) => `zenvio.attribution.${host}`;

export function captureAttribution(host: string): ClientAttribution {
  if (typeof window === "undefined" || host === "demo") return {};
  try {
    const existing = sessionStorage.getItem(key(host));
    if (existing) return JSON.parse(existing) as ClientAttribution;
  } catch {
    /* storage unavailable: fall through and capture from the URL */
  }
  const q = new URLSearchParams(window.location.search);
  const value: ClientAttribution = {
    source: q.get("src") || q.get("utm_source") || q.get("ref") || undefined,
    medium: q.get("utm_medium") || undefined,
    campaign: q.get("utm_campaign") || undefined,
    referrer: document.referrer || undefined,
  };
  let first = true;
  try {
    sessionStorage.setItem(key(host), JSON.stringify(value));
  } catch {
    first = false; // Without storage we can't dedupe, so don't count a view.
  }
  if (first)
    void fetch("/api/marketing/visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host, attribution: value }),
      keepalive: true,
    }).catch(() => {});
  return value;
}

export function readAttribution(host: string): ClientAttribution {
  try {
    const v = sessionStorage.getItem(key(host));
    return v ? (JSON.parse(v) as ClientAttribution) : {};
  } catch {
    return {};
  }
}
