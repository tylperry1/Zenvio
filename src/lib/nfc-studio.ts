import { createHash } from "node:crypto";
import { ApiError } from "./server";
import { normalizeHttpsUrl } from "./nfc/ndef";

export const NFC_TAG_STATUSES = ["registered", "programmed", "assigned", "failed", "retired", "lost"] as const;
export type NfcTagStatus = (typeof NFC_TAG_STATUSES)[number];

export function assertTagStatus(value: unknown): NfcTagStatus {
  if (typeof value !== "string" || !(NFC_TAG_STATUSES as readonly string[]).includes(value)) {
    throw new ApiError("Choose a valid tag status.");
  }
  return value as NfcTagStatus;
}

export function cleanTagLabel(value: unknown) {
  const label = String(value ?? "").trim();
  if (label.length > 120) throw new ApiError("Label must be 120 characters or fewer.");
  return label;
}

export function cleanDestinationUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    return normalizeHttpsUrl(raw);
  } catch (e) {
    throw new ApiError(e instanceof Error ? e.message : "Invalid destination URL.");
  }
}

export function cleanNotes(value: unknown) {
  const notes = String(value ?? "").trim();
  if (notes.length > 2000) throw new ApiError("Notes must be 2,000 characters or fewer.");
  return notes;
}

export function payloadHash(summary: string) {
  return createHash("sha256").update(summary).digest("hex");
}

export function summarizeRecords(records: Array<{ type: string; value: string }>) {
  if (!records.length) return "empty";
  return records
    .slice(0, 4)
    .map((r) => `${r.type}:${r.value.slice(0, 80)}`)
    .join(" | ")
    .slice(0, 500);
}

/** Public card path only — never accept client-supplied foreign hosts for Smart Card programming. */
export function smartCardProgramUrl(origin: string, token: string) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) throw new ApiError("Invalid Smart Card token.");
  return new URL(`/c/${token}`, origin.replace(/\/$/, "") + "/").toString();
}
