import { ApiError } from "./server";

/** Normalize guest phone numbers for booking and CRM. Prefer E.164. */
export function normalizeBookingPhone(value: string, required = true): string {
  const raw = value.trim();
  if (!raw) {
    if (required) throw new ApiError("Enter a telephone number for this booking.");
    return "";
  }
  const digits = raw.replace(/[^\d+]/g, "");
  let candidate = digits;
  if (candidate.startsWith("00")) candidate = "+" + candidate.slice(2);
  if (!candidate.startsWith("+")) {
    const only = candidate.replace(/\D/g, "");
    if (only.length === 10) candidate = "+1" + only;
    else if (only.length === 11 && only.startsWith("1")) candidate = "+" + only;
    else throw new ApiError("Enter a valid phone number including country code.");
  }
  if (!/^\+[1-9][0-9]{7,14}$/.test(candidate))
    throw new ApiError("Enter a valid phone number including country code.");
  return candidate;
}

export function formatPhoneDisplay(e164: string): string {
  const v = e164.trim();
  if (/^\+1[0-9]{10}$/.test(v)) {
    const n = v.slice(2);
    return `+1 (${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  }
  return v;
}

export function isLikelyPhone(value: string): boolean {
  try {
    normalizeBookingPhone(value, true);
    return true;
  } catch {
    return false;
  }
}
