import { createHash } from "node:crypto";
import { getPool } from "./db";
import { canonicalCardUrl } from "./digital-identity";
import { ApiError } from "./server";
import { normalizeHttpsUrl } from "./nfc/ndef";

export const NFC_TAG_STATUSES = ["registered", "programmed", "assigned", "failed", "retired", "lost"] as const;
export type NfcTagStatus = (typeof NFC_TAG_STATUSES)[number];

/** Platform toggle from /admin/nfc — default enabled when the row is missing. Lookup failures must not open Studio. */
export async function isNfcStudioEnabled() {
  const row = (await getPool().query(`SELECT value FROM private.platform_settings WHERE key='nfc_studio'`)).rows[0];
  return row?.value?.enabled !== false;
}

export async function assertNfcStudioEnabled() {
  if (!(await isNfcStudioEnabled())) throw new ApiError("NFC Studio is currently disabled.", 404);
}

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

/** Public card path only — never accept client-supplied foreign hosts for Smart Card programming.
 *  Appends src=nfc so analytics can attribute NFC taps separately from printed-card QR taps.
 *  Physical tags still resolve through /c/{token}; profile content edits do not require rewriting. */
export function smartCardProgramUrl(origin: string, token: string) {
  return canonicalCardUrl(origin, token, "nfc");
}
