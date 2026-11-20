/** Normalized NFC Studio types — platform adapters must map into these. */

export type NfcCapabilityState =
  | "ready"
  | "unsupported"
  | "permission_required"
  | "nfc_disabled"
  | "native_unavailable"
  | "browser_unavailable"
  | "busy";

export type NfcPlatform = "ios-native" | "android-native" | "web-nfc" | "none";

export type NdefRecordType =
  | "uri"
  | "text"
  | "tel"
  | "mailto"
  | "sms"
  | "vcard"
  | "mime"
  | "unknown";

export type NdefRecord = {
  type: NdefRecordType;
  /** Human-readable type label */
  label: string;
  /** Primary payload as text/URL when safely representable */
  value: string;
  mimeType?: string;
  language?: string;
  /** Hex dump only when useful and short */
  rawHex?: string;
};

export type NdefMessage = {
  records: NdefRecord[];
  byteLength: number;
};

export type TagSnapshot = {
  technology?: string;
  ndefSupported: boolean;
  writable?: boolean;
  readOnly?: boolean;
  capacityBytes?: number;
  usedBytes?: number;
  message?: NdefMessage;
  /** Optional, privacy-sensitive — never sole identity */
  hardwareId?: string;
};

export type NfcCapabilities = {
  state: NfcCapabilityState;
  platform: NfcPlatform;
  canRead: boolean;
  canWrite: boolean;
  canMakeReadOnly: boolean;
  canFormat: boolean;
  /** Short user-facing reason when not ready */
  detail: string;
};

export type WriteRequest = {
  message: NdefMessage;
  /** When true, overwrite existing NDEF after user confirmed in UI */
  overwriteConfirmed: boolean;
};

export type WriteResult = {
  ok: boolean;
  verified: boolean;
  tag?: TagSnapshot;
  written?: NdefMessage;
  readBack?: NdefMessage;
  errorCode?: string;
  errorMessage?: string;
};

export type ReadResult = {
  ok: boolean;
  tag?: TagSnapshot;
  errorCode?: string;
  errorMessage?: string;
};

export type LockResult = {
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
};

export type NfcAdapter = {
  getCapabilities(): Promise<NfcCapabilities>;
  startReading(signal?: AbortSignal): Promise<ReadResult>;
  stopReading(): Promise<void>;
  writeNdef(request: WriteRequest, signal?: AbortSignal): Promise<WriteResult>;
  verifyNdef(expected: NdefMessage, signal?: AbortSignal): Promise<WriteResult>;
  getTagStatus(signal?: AbortSignal): Promise<ReadResult>;
  makeReadOnly(signal?: AbortSignal): Promise<LockResult>;
  cancelOperation(): Promise<void>;
};
