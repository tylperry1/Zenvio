import type { NfcAdapter, NfcCapabilities, ReadResult, WriteRequest, WriteResult, LockResult, NdefMessage } from "./types";
import { messagesEquivalent } from "./ndef";

type NativeBridge = {
  getCapabilities: () => Promise<NfcCapabilities>;
  startReading: () => Promise<ReadResult>;
  stopReading: () => Promise<void>;
  writeNdef: (payload: { records: NdefMessage["records"]; overwriteConfirmed: boolean }) => Promise<WriteResult>;
  makeReadOnly: () => Promise<LockResult>;
  cancelOperation: () => Promise<void>;
};

declare global {
  interface Window {
    ZenvioNfc?: NativeBridge;
  }
}

export function hasCapacitorNfcBridge(): boolean {
  return typeof window !== "undefined" && typeof window.ZenvioNfc?.getCapabilities === "function";
}

export function createCapacitorNfcAdapter(): NfcAdapter {
  const bridge = () => {
    if (!hasCapacitorNfcBridge()) throw new Error("Native NFC bridge is not available.");
    return window.ZenvioNfc!;
  };

  return {
    async getCapabilities() {
      if (!hasCapacitorNfcBridge()) {
        return {
          state: "native_unavailable",
          platform: "none",
          canRead: false,
          canWrite: false,
          canMakeReadOnly: false,
          canFormat: false,
          detail: "Open NFC Studio in the Zenvio native shell to use Core NFC / Android NFC.",
        };
      }
      return bridge().getCapabilities();
    },
    async startReading() {
      return bridge().startReading();
    },
    async stopReading() {
      await bridge().stopReading();
    },
    async writeNdef(request: WriteRequest) {
      return bridge().writeNdef({
        records: request.message.records,
        overwriteConfirmed: request.overwriteConfirmed,
      });
    },
    async verifyNdef(expected: NdefMessage) {
      const read = await bridge().startReading();
      if (!read.ok || !read.tag?.message) {
        return { ok: false, verified: false, errorCode: read.errorCode, errorMessage: read.errorMessage };
      }
      const verified = messagesEquivalent(expected, read.tag.message);
      return { ok: verified, verified, written: expected, readBack: read.tag.message, tag: read.tag };
    },
    async getTagStatus() {
      return bridge().startReading();
    },
    async makeReadOnly() {
      return bridge().makeReadOnly();
    },
    async cancelOperation() {
      await bridge().cancelOperation();
    },
  };
}
