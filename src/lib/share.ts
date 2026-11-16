export type ShareResult = "shared" | "copied" | "cancelled" | "unavailable";

export type SharePayload = {
  url: string;
  title?: string;
  text?: string;
};

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

export function canNativeShare(
  payload?: SharePayload,
  nav: ShareNavigator | undefined = typeof navigator === "undefined" ? undefined : navigator,
) {
  if (!nav?.share) return false;
  if (!payload || typeof nav.canShare !== "function") return true;
  try {
    return nav.canShare({ title: payload.title, text: payload.text, url: payload.url });
  } catch {
    try {
      return nav.canShare({ title: payload.title, text: payload.text });
    } catch {
      return true;
    }
  }
}

function copyLegacy(text: string) {
  if (typeof document === "undefined") return false;
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.top = "0";
  field.style.left = "-9999px";
  document.body.append(field);
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
  if (canNativeShare(payload, nav) && nav?.share) {
    try {
      await nav.share({
        title: payload.title,
        text: payload.text,
        url: payload.url,
      });
      return "shared";
    } catch (error) {
      if (isAbort(error)) return "cancelled";
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
