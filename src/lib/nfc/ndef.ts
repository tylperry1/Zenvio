import type { NdefMessage, NdefRecord, NdefRecordType } from "./types";

const URI_PREFIXES = [
  "",
  "http://www.",
  "https://www.",
  "http://",
  "https://",
  "tel:",
  "mailto:",
  "ftp://anonymous:anonymous@",
  "ftp://ftp.",
  "ftps://",
  "sftp://",
  "smb://",
  "nfs://",
  "ftp://",
  "dav://",
  "news:",
  "telnet://",
  "imap:",
  "rtsp://",
  "urn:",
  "pop:",
  "sip:",
  "sips:",
  "tftp:",
  "btspp://",
  "btl2cap://",
  "btgoep://",
  "tcpobex://",
  "irdaobex://",
  "file://",
  "urn:epc:id:",
  "urn:epc:tag:",
  "urn:epc:pat:",
  "urn:epc:raw:",
  "urn:epc:",
  "urn:nfc:",
] as const;

const enc = new TextEncoder();
const dec = new TextDecoder();

function bytes(...parts: Array<number | Uint8Array>): Uint8Array {
  const arrays = parts.map((p) => (typeof p === "number" ? Uint8Array.of(p) : p));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

function uriPrefixIndex(url: string): { code: number; rest: string } {
  let best = 0;
  for (let i = 1; i < URI_PREFIXES.length; i++) {
    const p = URI_PREFIXES[i];
    if (url.startsWith(p) && p.length > URI_PREFIXES[best].length) best = i;
  }
  return { code: best, rest: url.slice(URI_PREFIXES[best].length) };
}

/** TNF header + type + payload length (1-byte SR or 4-byte long form). */
function encodeRecordFrame(tnf: number, type: Uint8Array, payload: Uint8Array, mb: boolean, me: boolean): Uint8Array {
  const sr = payload.length < 256;
  const header = (mb ? 0x80 : 0) | (me ? 0x40 : 0) | (sr ? 0x10 : 0) | tnf;
  if (sr) return bytes(header, type.length, payload.length, type, payload);
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, payload.length);
  return bytes(header, type.length, len, type, payload);
}

/** Serialize a Well-Known URI (U) record payload including TNF header framing for one record. */
function encodeUriRecord(url: string, mb: boolean, me: boolean): Uint8Array {
  const { code, rest } = uriPrefixIndex(url);
  const payload = bytes(code, enc.encode(rest));
  return encodeRecordFrame(0x01, enc.encode("U"), payload, mb, me);
}

function encodeTextRecord(text: string, language: string, mb: boolean, me: boolean): Uint8Array {
  const lang = enc.encode(language.slice(0, 63) || "en");
  const status = lang.length & 0x3f; // UTF-8
  const payload = bytes(status, lang, enc.encode(text));
  return encodeRecordFrame(0x01, enc.encode("T"), payload, mb, me);
}

function encodeMimeRecord(mime: string, data: Uint8Array, mb: boolean, me: boolean): Uint8Array {
  return encodeRecordFrame(0x02, enc.encode(mime.slice(0, 255)), data, mb, me);
}

export function normalizeHttpsUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error("Enter a URL.");
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("That URL is not valid.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http(s) URLs are supported.");
  if (url.username || url.password) throw new Error("URLs must not include credentials.");
  if (url.href.includes("\n") || url.href.includes("\r")) throw new Error("URLs must not contain line breaks.");
  return url.toString();
}

export function recordFromEditor(
  kind: "uri" | "text" | "tel" | "mailto" | "sms" | "vcard" | "mime" | "smart_card",
  value: string,
  extra: { mimeType?: string; language?: string; name?: string; organization?: string } = {},
): NdefRecord {
  switch (kind) {
    case "uri":
    case "smart_card": {
      const url = normalizeHttpsUrl(value);
      return { type: "uri", label: kind === "smart_card" ? "Zenvio Smart Card" : "Website URL", value: url };
    }
    case "text": {
      const text = value.trim();
      if (!text || text.length > 2000) throw new Error("Enter text up to 2,000 characters.");
      return { type: "text", label: "Plain text", value: text, language: extra.language || "en" };
    }
    case "tel": {
      const phone = value.replace(/[^\d+]/g, "");
      if (phone.length < 7) throw new Error("Enter a valid phone number.");
      return { type: "tel", label: "Telephone", value: `tel:${phone}` };
    }
    case "mailto": {
      const email = value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
      return { type: "mailto", label: "Email", value: `mailto:${email}` };
    }
    case "sms": {
      const phone = value.replace(/[^\d+]/g, "");
      if (phone.length < 7) throw new Error("Enter a valid SMS number.");
      return { type: "sms", label: "SMS", value: `sms:${phone}` };
    }
    case "vcard": {
      const name = (extra.name || value).trim();
      if (!name) throw new Error("Enter a contact name.");
      const lines = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `FN:${name.replace(/\n/g, "\\n")}`,
        extra.organization ? `ORG:${extra.organization.replace(/\n/g, "\\n")}` : "",
        value.includes("@") ? `EMAIL:${value.trim()}` : "",
        "END:VCARD",
      ].filter(Boolean);
      return { type: "vcard", label: "Contact (vCard)", value: lines.join("\n"), mimeType: "text/vcard" };
    }
    case "mime": {
      const mime = (extra.mimeType || "application/octet-stream").trim();
      if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mime)) throw new Error("Enter a valid MIME type.");
      const text = value;
      if (text.length > 4000) throw new Error("MIME payload is too large.");
      return { type: "mime", label: `MIME (${mime})`, value: text, mimeType: mime };
    }
    default:
      throw new Error("Unsupported record type.");
  }
}

export function serializeNdef(records: NdefRecord[]): Uint8Array {
  if (!records.length) throw new Error("Add at least one NDEF record.");
  if (records.length > 8) throw new Error("At most 8 records per message.");
  const chunks: Uint8Array[] = [];
  records.forEach((r, i) => {
    const mb = i === 0;
    const me = i === records.length - 1;
    if (r.type === "uri" || r.type === "tel" || r.type === "mailto" || r.type === "sms") {
      chunks.push(encodeUriRecord(r.value, mb, me));
    } else if (r.type === "text") {
      chunks.push(encodeTextRecord(r.value, r.language || "en", mb, me));
    } else if (r.type === "vcard" || r.type === "mime") {
      chunks.push(encodeMimeRecord(r.mimeType || "application/octet-stream", enc.encode(r.value), mb, me));
    } else {
      throw new Error(`Cannot serialize record type ${r.type}.`);
    }
  });
  return bytes(...chunks);
}

export function estimateNdefBytes(records: NdefRecord[]): number {
  return serializeNdef(records).length;
}

function parseUriPayload(payload: Uint8Array): string {
  if (!payload.length) return "";
  const code = payload[0];
  const rest = dec.decode(payload.subarray(1));
  const prefix = URI_PREFIXES[code] ?? "";
  return prefix + rest;
}

function parseTextPayload(payload: Uint8Array): { text: string; language: string } {
  if (!payload.length) return { text: "", language: "en" };
  const status = payload[0];
  const utf16 = Boolean(status & 0x80);
  const langLen = status & 0x3f;
  const language = dec.decode(payload.subarray(1, 1 + langLen)) || "en";
  const textBytes = payload.subarray(1 + langLen);
  const text = utf16 ? new TextDecoder("utf-16").decode(textBytes) : dec.decode(textBytes);
  return { text, language };
}

export function classifyUri(value: string): NdefRecordType {
  if (value.startsWith("tel:")) return "tel";
  if (value.startsWith("mailto:")) return "mailto";
  if (value.startsWith("sms:")) return "sms";
  return "uri";
}

/** Decode a read-back payload without editor validation (tel/email/sms/vcard/unknown allowed). */
export function recordFromReadValue(
  kind: "uri" | "text" | "mime" | "unknown",
  value: string,
  extra: { mimeType?: string; language?: string; label?: string } = {},
): NdefRecord {
  if (kind === "uri") {
    const t = classifyUri(value);
    return {
      type: t,
      label: t === "tel" ? "Telephone" : t === "mailto" ? "Email" : t === "sms" ? "SMS" : "URI",
      value,
    };
  }
  if (kind === "text") {
    return { type: "text", label: "Plain text", value, language: extra.language || "en" };
  }
  if (kind === "mime") {
    const mime = extra.mimeType || "application/octet-stream";
    const isVcard = /vcard/i.test(mime);
    return {
      type: isVcard ? "vcard" : "mime",
      label: isVcard ? "Contact (vCard)" : `MIME (${mime})`,
      value,
      mimeType: mime,
    };
  }
  return {
    type: "unknown",
    label: extra.label || "Unknown",
    value,
    mimeType: extra.mimeType,
  };
}

/** Parse a binary NDEF message into normalized records (Well-Known + MIME subset). */
export function parseNdef(data: Uint8Array): NdefMessage {
  const records: NdefRecord[] = [];
  let i = 0;
  while (i < data.length) {
    const header = data[i++];
    const mb = Boolean(header & 0x80);
    const me = Boolean(header & 0x40);
    const sr = Boolean(header & 0x10);
    const il = Boolean(header & 0x08);
    const tnf = header & 0x07;
    if (i >= data.length) break;
    const typeLen = data[i++];
    let payloadLen = 0;
    if (sr) {
      if (i >= data.length) break;
      payloadLen = data[i++];
    } else {
      if (i + 4 > data.length) break;
      payloadLen = new DataView(data.buffer, data.byteOffset + i, 4).getUint32(0);
      i += 4;
    }
    let idLen = 0;
    if (il) {
      if (i >= data.length) break;
      idLen = data[i++];
    }
    const type = dec.decode(data.subarray(i, i + typeLen));
    i += typeLen;
    i += idLen;
    const payload = data.subarray(i, i + payloadLen);
    i += payloadLen;

    if (tnf === 0x01 && type === "U") {
      const value = parseUriPayload(payload);
      const t = classifyUri(value);
      records.push({
        type: t,
        label: t === "tel" ? "Telephone" : t === "mailto" ? "Email" : t === "sms" ? "SMS" : "URI",
        value,
        rawHex: toHex(payload.slice(0, 64)),
      });
    } else if (tnf === 0x01 && type === "T") {
      const { text, language } = parseTextPayload(payload);
      records.push({ type: "text", label: "Plain text", value: text, language, rawHex: toHex(payload.slice(0, 64)) });
    } else if (tnf === 0x02) {
      const mime = type;
      const value = dec.decode(payload);
      const isVcard = /vcard/i.test(mime);
      records.push({
        type: isVcard ? "vcard" : "mime",
        label: isVcard ? "Contact (vCard)" : `MIME (${mime})`,
        value,
        mimeType: mime,
        rawHex: toHex(payload.slice(0, 64)),
      });
    } else {
      records.push({
        type: "unknown",
        label: `TNF ${tnf} / ${type || "empty"}`,
        value: "",
        rawHex: toHex(payload.slice(0, 64)),
      });
    }
    if (me || (!mb && records.length && me)) {
      /* continue until buffer ends; ME ends logical message */
    }
    if (me) break;
  }
  return { records, byteLength: data.length };
}

export function messagesEquivalent(a: NdefMessage, b: NdefMessage): boolean {
  if (a.records.length !== b.records.length) return false;
  return a.records.every((r, i) => {
    const o = b.records[i];
    if (r.type !== o.type) return false;
    if ((r.mimeType || "") !== (o.mimeType || "")) return false;
    if (r.type === "text" && (r.language || "en") !== (o.language || "en")) return false;
    return valuesEquivalent(r.type, r.value, o.value);
  });
}

/**
 * Compare payload values without case-folding Smart Card paths or text.
 * Host/scheme are case-insensitive; path/query/fragment and non-URL text stay exact.
 */
function valuesEquivalent(type: NdefRecordType, left: string, right: string): boolean {
  if (type === "text" || type === "vcard" || type === "mime" || type === "unknown") {
    return left === right;
  }
  if (type === "tel" || type === "mailto" || type === "sms") {
    return left.trim() === right.trim();
  }
  return normalizeHttpUrlCompare(left) === normalizeHttpUrlCompare(right);
}

function normalizeHttpUrlCompare(v: string): string {
  const trimmed = v.trim();
  try {
    const u = new URL(trimmed);
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return trimmed.replace(/\/$/, "");
  }
}

/** Batch destination match — preserves path case so Smart Card tokens stay exact. */
export function destinationsMatch(a: string, b: string): boolean {
  return normalizeHttpUrlCompare(a) === normalizeHttpUrlCompare(b);
}

function toHex(buf: Uint8Array) {
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function messageFromRecords(records: NdefRecord[]): NdefMessage {
  if (!records.length) return { records, byteLength: 0 };
  if (records.some((r) => r.type === "unknown")) {
    return { records, byteLength: records.reduce((n, r) => n + (r.value?.length || 0), 0) };
  }
  const binary = serializeNdef(records);
  return { records, byteLength: binary.length };
}
