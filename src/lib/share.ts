export type ShareResult = "shared" | "copied" | "cancelled" | "unavailable";

export type SharePayload = {
  url: string;
  title?: string;
  text?: string;
};

const CANONICAL_ORIGIN = "https://gozenvio.com";

function originOf(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isAliasHost(hostname: string) {
  return (
    hostname === "www.gozenvio.com" ||
    hostname === "zenvio-two.vercel.app" ||
    hostname.endsWith(".vercel.app")
  );
}

function canonicalOrLocal(origin: string) {
  const host = new URL(origin).hostname;
  if (isLocalHost(host)) return origin;
  if (isAliasHost(host) || host === "gozenvio.com") return CANONICAL_ORIGIN;
  return origin;
}

/** Public booking/profile links always point at production, not a preview host. */
export function publicShareOrigin(pageOrigin = "") {
  const page = originOf(pageOrigin);
  if (page) return canonicalOrLocal(page);
  const configured = originOf(process.env.NEXT_PUBLIC_APP_URL || "");
  if (configured) return canonicalOrLocal(configured);
  return CANONICAL_ORIGIN;
}

export function publicShareUrl(pathOrUrl: string, pageOrigin = "") {
  try {
    const origin = publicShareOrigin(pageOrigin);
    const resolved = new URL(pathOrUrl, `${origin}/`);
    if (isLocalHost(resolved.hostname)) return resolved.href;
    if (isAliasHost(resolved.hostname) || resolved.hostname === "gozenvio.com") {
      resolved.protocol = "https:";
      resolved.hostname = "gozenvio.com";
      resolved.port = "";
    }
    return resolved.href;
  } catch {
    return pathOrUrl;
  }
}

type ShareNavigator = {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  clipboard?: { writeText: (text: string) => Promise<void> };
};

function isAbort(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name: string }).name === "AbortError"
  );
}

function shareText(payload: SharePayload) {
  const parts = [payload.text, payload.url].filter((part, index, all) => part && all.indexOf(part) === index);
  return parts.join("\n\n");
}

function nativeShareAllowed(data: ShareData, nav: ShareNavigator) {
  if (typeof nav.canShare !== "function") return true;
  try {
    return nav.canShare(data);
  } catch {
    return false;
  }
}

export function canNativeShare(
  payload?: SharePayload,
  nav: ShareNavigator | undefined = typeof navigator === "undefined" ? undefined : navigator,
) {
  if (!nav?.share) return false;
  if (!payload || typeof nav.canShare !== "function") return true;
  const withUrl = { title: payload.title, text: payload.text, url: payload.url };
  const textOnly = { title: payload.title, text: shareText(payload) };
  return nativeShareAllowed(withUrl, nav) || nativeShareAllowed(textOnly, nav);
}

function copyLegacy(text: string) {
  if (typeof document === "undefined") return false;
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.top = "0";
  field.style.left = "-9999px";
  const host = document.querySelector("dialog[open]") || document.body;
  host.append(field);
  field.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  field.remove();
  return ok;
}

export async function copyText(
  text: string,
  nav: ShareNavigator | undefined = typeof navigator === "undefined" ? undefined : navigator,
) {
  try {
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to a selection-based copy */
  }
  return copyLegacy(text);
}

export async function shareOrCopy(
  payload: SharePayload,
  nav: ShareNavigator | undefined = typeof navigator === "undefined" ? undefined : navigator,
): Promise<ShareResult> {
  if (nav?.share) {
    const withUrl = { title: payload.title, text: payload.text, url: payload.url };
    const textOnly = { title: payload.title, text: shareText(payload) };
    const first = nativeShareAllowed(withUrl, nav) ? withUrl : textOnly;
    const second = first === withUrl ? textOnly : null;
    try {
      await nav.share(first);
      return "shared";
    } catch (error) {
      if (isAbort(error)) return "cancelled";
      if (second) {
        try {
          await nav.share(second);
          return "shared";
        } catch (retry) {
          if (isAbort(retry)) return "cancelled";
        }
      }
    }
  }
  return (await copyText(payload.url, nav)) ? "copied" : "unavailable";
}

export function bookingSharePayload(url: string, hostName: string, eventTitle?: string): SharePayload {
  const title = eventTitle ? `${eventTitle} · ${hostName}` : hostName;
  const text = eventTitle
    ? `Book a time for ${eventTitle} with ${hostName}`
    : `Book a time with ${hostName}`;
  return { url, title, text };
}

export function emailShareHref(payload: SharePayload) {
  const subject = payload.title || "Book a time";
  const body = `${payload.text || subject}\n\n${payload.url}`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function smsShareHref(payload: SharePayload) {
  const body = `${payload.text || payload.title || "Book a time"} ${payload.url}`.trim();
  return `sms:?&body=${encodeURIComponent(body)}`;
}

export function shareResultMessage(result: ShareResult, copied = "Link copied. Paste it anywhere.") {
  if (result === "shared") return "Share options opened.";
  if (result === "copied") return copied;
  if (result === "unavailable") return "Couldn’t copy automatically. Select the link and copy it.";
  return "";
}
