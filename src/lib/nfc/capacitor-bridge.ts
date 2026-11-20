import type { NfcAdapter, NfcCapabilities, ReadResult, WriteRequest, WriteResult, LockResult, NdefMessage } from "./types";
import { messagesEquivalent, parseNdef, serializeNdef } from "./ndef";

/** Native shell receives pre-serialized NDEF bytes (base64). Writing is only claimed ready when canWrite is true. */
type NativeBridge = {
  getCapabilities: () => Promise<NfcCapabilities>;
  startReading: () => Promise<ReadResult>;
  stopReading: () => Promise<void>;
  writeNdef: (payload: { ndefBase64: string; overwriteConfirmed: boolean }) => Promise<WriteResult>;
  makeReadOnly: () => Promise<LockResult>;
  cancelOperation: () => Promise<void>;
};

declare global {
  interface Window {
    ZenvioNfc?: NativeBridge;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** If native returns message bytes instead of structured records, parse them for the web layer. */
function hydrateReadResult(result: ReadResult): ReadResult {
  if (!result.ok || !result.tag) return result;
  const tag = result.tag as ReadResult["tag"] & { messageBase64?: string };
  if (tag.message?.records) return result;
  if (typeof tag.messageBase64 === "string" && tag.messageBase64) {
    try {
      const message = parseNdef(base64ToBytes(tag.messageBase64));
      const { messageBase64: _drop, ...rest } = tag;
      void _drop;
      return { ...result, tag: { ...rest, message, usedBytes: message.byteLength } };
    } catch {
      return result;
    }
  }
  return result;
}

export function hasCapacitorNfcBridge(): boolean {
  return typeof window !== "undefined" && typeof window.ZenvioNfc?.getCapabilities === "function";
}

export function createCapacitorNfcAdapter(): NfcAdapter {
  const bridge = () => {
    if (!hasCapacitorNfcBridge()) throw new Error("Native NFC bridge is not available.");
    return window.ZenvioNfc!;
  };

  /** Invalidated by cancelOperation so awaits after cancel cannot start native work. */
  let opGeneration = 0;
  const beginOp = () => {
    opGeneration += 1;
    return opGeneration;
  };
  const ownsOp = (op: number) => op === opGeneration;
  const cancelledResult = (): WriteResult => ({
    ok: false,
    verified: false,
    errorCode: "cancelled",
    errorMessage: "Cancelled.",
  });

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
      return hydrateReadResult(await bridge().startReading());
    },
    async stopReading() {
      await bridge().stopReading();
    },
    async writeNdef(request: WriteRequest) {
      const op = beginOp();
      const caps = await bridge().getCapabilities();
      if (!ownsOp(op)) return cancelledResult();
      if (!caps.canWrite) {
        return {
          ok: false,
          verified: false,
          errorCode: "integration_pending",
          errorMessage: caps.detail || "Native NFC writing is not available in this shell build.",
        };
      }
      const ndefBase64 = bytesToBase64(serializeNdef(request.message.records));
      if (!ownsOp(op)) return cancelledResult();
      const result = await bridge().writeNdef({
        ndefBase64,
        overwriteConfirmed: request.overwriteConfirmed,
      });
      if (!ownsOp(op)) return cancelledResult();
      if (result.readBack || result.tag) {
        const hydrated = hydrateReadResult({
          ok: true,
          tag: result.tag || { ndefSupported: true, message: result.readBack },
        });
        return {
          ...result,
          tag: hydrated.tag,
          readBack: hydrated.tag?.message || result.readBack,
        };
      }
      return result;
    },
    async verifyNdef(expected: NdefMessage) {
      const read = hydrateReadResult(await bridge().startReading());
      if (!read.ok || !read.tag?.message) {
        return { ok: false, verified: false, errorCode: read.errorCode, errorMessage: read.errorMessage };
      }
      const verified = messagesEquivalent(expected, read.tag.message);
      return { ok: verified, verified, written: expected, readBack: read.tag.message, tag: read.tag };
    },
    async getTagStatus() {
      return hydrateReadResult(await bridge().startReading());
    },
    async makeReadOnly() {
      return bridge().makeReadOnly();
    },
    async cancelOperation() {
      beginOp(); // invalidate in-flight adapter waits (e.g. getCapabilities before write)
      await bridge().cancelOperation();
    },
  };
}
