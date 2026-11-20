import type { NfcAdapter, NfcCapabilities, ReadResult, WriteRequest, WriteResult, LockResult } from "./types";
import { messageFromRecords, messagesEquivalent, recordFromReadValue, serializeNdef } from "./ndef";

type NDEFReadingEvent = Event & {
  message: {
    records: Array<{ recordType: string; mediaType?: string; data?: DataView; encoding?: string; lang?: string }>;
  };
};
type NDEFReaderLike = {
  scan: (opts?: { signal?: AbortSignal }) => Promise<void>;
  write: (message: unknown, opts?: { signal?: AbortSignal; overwrite?: boolean }) => Promise<void>;
  makeReadOnly?: (opts?: { signal?: AbortSignal }) => Promise<void>;
  addEventListener: (type: string, listener: (ev: NDEFReadingEvent) => void) => void;
  removeEventListener: (type: string, listener: (ev: NDEFReadingEvent) => void) => void;
};

function readerCtor(): (new () => NDEFReaderLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { NDEFReader?: new () => NDEFReaderLike };
  return w.NDEFReader || null;
}

function isSecure(): boolean {
  return typeof window !== "undefined" && window.isSecureContext;
}

function recordsFromWeb(message: NDEFReadingEvent["message"]) {
  // Decode without editor restrictions so tel/email/sms/vcard/unknown read-backs verify.
  const records = message.records.map((r) => {
    if (r.recordType === "url" || r.recordType === "absolute-url") {
      const value = r.data ? new TextDecoder(r.encoding || "utf-8").decode(r.data) : "";
      return recordFromReadValue("uri", value);
    }
    if (r.recordType === "text") {
      const value = r.data ? new TextDecoder(r.encoding || "utf-8").decode(r.data) : "";
      return recordFromReadValue("text", value, { language: r.lang || "en" });
    }
    if (r.recordType === "mime") {
      const value = r.data ? new TextDecoder().decode(r.data) : "";
      return recordFromReadValue("mime", value, { mimeType: r.mediaType || "application/octet-stream" });
    }
    return recordFromReadValue("unknown", r.data ? new TextDecoder().decode(r.data).slice(0, 500) : "", {
      label: r.recordType,
      mimeType: r.mediaType,
    });
  });
  return messageFromRecords(records);
}

export function createWebNfcAdapter(): NfcAdapter {
  let active: AbortController | null = null;

  async function getCapabilities(): Promise<NfcCapabilities> {
    const Ctor = readerCtor();
    if (!Ctor) {
      return {
        state: "browser_unavailable",
        platform: "none",
        canRead: false,
        canWrite: false,
        canMakeReadOnly: false,
        canFormat: false,
        detail:
          "Web NFC is not available in this browser. On Android, use Chrome over HTTPS, or open Zenvio’s native NFC shell. iPhone Safari cannot access Core NFC.",
      };
    }
    if (!isSecure()) {
      return {
        state: "browser_unavailable",
        platform: "web-nfc",
        canRead: false,
        canWrite: false,
        canMakeReadOnly: false,
        canFormat: false,
        detail: "Web NFC requires a secure HTTPS context.",
      };
    }
    return {
      state: "ready",
      platform: "web-nfc",
      canRead: true,
      canWrite: true,
      canMakeReadOnly: typeof Ctor.prototype.makeReadOnly === "function",
      canFormat: false,
      detail: "Web NFC (NDEF only) is available in this browser session.",
    };
  }

  async function startReading(signal?: AbortSignal): Promise<ReadResult> {
    const Ctor = readerCtor();
    if (!Ctor) return { ok: false, errorCode: "unavailable", errorMessage: "Web NFC is not available." };
    await cancelOperation();
    active = new AbortController();
    if (signal) signal.addEventListener("abort", () => active?.abort(), { once: true });
    const reader = new Ctor();
    const controller = active;
    try {
      const tag = await new Promise<ReadResult>((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          reader.removeEventListener("reading", onReading);
          controller.signal.removeEventListener("abort", onAbort);
          fn();
        };
        const onAbort = () =>
          finish(() => reject(Object.assign(new Error("Scan cancelled."), { name: "AbortError" })));
        const onReading = (ev: NDEFReadingEvent) => {
          finish(() => {
            try {
              const message = recordsFromWeb(ev.message);
              resolve({
                ok: true,
                tag: {
                  ndefSupported: true,
                  message,
                  usedBytes: message.byteLength,
                },
              });
            } catch (e) {
              reject(e);
            } finally {
              try {
                controller.abort();
              } catch {
                /* scan stop is best-effort */
              }
            }
          });
        };
        reader.addEventListener("reading", onReading);
        controller.signal.addEventListener("abort", onAbort, { once: true });
        if (controller.signal.aborted) {
          onAbort();
          return;
        }
        reader.scan({ signal: controller.signal }).catch((e) => finish(() => reject(e)));
      });
      return tag;
    } catch (e) {
      const err = e as { name?: string; message?: string };
      if (err.name === "AbortError") return { ok: false, errorCode: "cancelled", errorMessage: "Scan cancelled." };
      if (err.name === "NotAllowedError")
        return { ok: false, errorCode: "permission", errorMessage: "NFC permission was denied." };
      return { ok: false, errorCode: "read_failed", errorMessage: err.message || "Unable to read this tag." };
    } finally {
      if (active === controller) active = null;
    }
  }

  async function writeNdef(request: WriteRequest, signal?: AbortSignal): Promise<WriteResult> {
    const Ctor = readerCtor();
    if (!Ctor) return { ok: false, verified: false, errorCode: "unavailable", errorMessage: "Web NFC is not available." };
    if (!request.overwriteConfirmed) {
      return { ok: false, verified: false, errorCode: "confirm_overwrite", errorMessage: "Confirm overwrite before writing." };
    }
    await cancelOperation();
    active = new AbortController();
    if (signal) signal.addEventListener("abort", () => active?.abort(), { once: true });
    const reader = new Ctor();
    const binary = serializeNdef(request.message.records);
    try {
      // Web NFC write API accepts a structured message; pass records as absolute URLs / text where possible.
      await reader.write(
        {
          records: request.message.records.map((r) => {
            if (r.type === "uri" || r.type === "tel" || r.type === "mailto" || r.type === "sms")
              return { recordType: "url", data: r.value };
            if (r.type === "text") return { recordType: "text", data: r.value, lang: r.language || "en" };
            return {
              recordType: "mime",
              mediaType: r.mimeType || "application/octet-stream",
              data: new TextEncoder().encode(r.value),
            };
          }),
        },
        { signal: active.signal, overwrite: true },
      );
      // Read-after-write
      const verify = await startReading(signal);
      if (!verify.ok || !verify.tag?.message) {
        return {
          ok: true,
          verified: false,
          written: request.message,
          errorCode: "verify_failed",
          errorMessage: "Write reported success but read-back could not be confirmed.",
          tag: verify.tag,
        };
      }
      const verified = messagesEquivalent(request.message, verify.tag.message);
      return {
        ok: true,
        verified,
        written: request.message,
        readBack: verify.tag.message,
        tag: verify.tag,
        errorCode: verified ? undefined : "verify_mismatch",
        errorMessage: verified ? undefined : "Read-back did not match the written payload.",
      };
    } catch (e) {
      const err = e as { name?: string; message?: string };
      if (err.name === "AbortError") return { ok: false, verified: false, errorCode: "cancelled", errorMessage: "Write cancelled." };
      return { ok: false, verified: false, errorCode: "write_failed", errorMessage: err.message || "Unable to write this tag." };
    } finally {
      active = null;
      void binary;
    }
  }

  async function verifyNdef(expected: import("./types").NdefMessage, signal?: AbortSignal): Promise<WriteResult> {
    const read = await startReading(signal);
    if (!read.ok || !read.tag?.message)
      return { ok: false, verified: false, errorCode: read.errorCode, errorMessage: read.errorMessage || "Verify read failed." };
    const verified = messagesEquivalent(expected, read.tag.message);
    return { ok: verified, verified, written: expected, readBack: read.tag.message, tag: read.tag };
  }

  async function makeReadOnly(signal?: AbortSignal): Promise<LockResult> {
    const Ctor = readerCtor();
    if (!Ctor?.prototype.makeReadOnly)
      return { ok: false, errorCode: "unsupported", errorMessage: "This environment cannot permanently lock tags." };
    await cancelOperation();
    active = new AbortController();
    if (signal) signal.addEventListener("abort", () => active?.abort(), { once: true });
    try {
      const reader = new Ctor();
      await reader.makeReadOnly!({ signal: active.signal });
      return { ok: true };
    } catch (e) {
      const err = e as { message?: string };
      return { ok: false, errorCode: "lock_failed", errorMessage: err.message || "Unable to lock this tag." };
    } finally {
      active = null;
    }
  }

  async function cancelOperation() {
    active?.abort();
    active = null;
  }

  return {
    getCapabilities,
    startReading,
    stopReading: cancelOperation,
    writeNdef,
    verifyNdef,
    getTagStatus: startReading,
    makeReadOnly,
    cancelOperation,
  };
}
