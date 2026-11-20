import type { NfcAdapter, NfcCapabilities } from "./types";
import { createCapacitorNfcAdapter, hasCapacitorNfcBridge } from "./capacitor-bridge";
import { createWebNfcAdapter } from "./web-nfc";

let cached: NfcAdapter | null = null;

/** Prefer native Capacitor bridge; otherwise Web NFC; otherwise a no-op honest adapter. */
export function getNfcAdapter(): NfcAdapter {
  if (cached) return cached;
  if (hasCapacitorNfcBridge()) {
    cached = createCapacitorNfcAdapter();
    return cached;
  }
  cached = createWebNfcAdapter();
  return cached;
}

export async function probeNfcCapabilities(): Promise<NfcCapabilities> {
  return getNfcAdapter().getCapabilities();
}

/** Test helper — clear memoized adapter between environments. */
export function resetNfcAdapterCache() {
  cached = null;
}
