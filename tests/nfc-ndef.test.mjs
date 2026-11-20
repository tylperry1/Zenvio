import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import test from "node:test";
import ts from "typescript";

function load(file) {
  const filename = path.resolve(file);
  const m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  m._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText,
    filename,
  );
  return m.exports;
}

const N = load("src/lib/nfc/ndef.ts");

test("normalizes https URLs and rejects credentials", () => {
  assert.equal(N.normalizeHttpsUrl("gozenvio.com/c/abc"), "https://gozenvio.com/c/abc");
  assert.throws(() => N.normalizeHttpsUrl("https://user:pass@example.com"), /credentials/);
  assert.throws(() => N.normalizeHttpsUrl("javascript:alert(1)"), /http/);
});

test("serializes and parses URI + text NDEF messages", () => {
  const records = [
    N.recordFromEditor("uri", "https://gozenvio.com/c/testtoken1234567890"),
    N.recordFromEditor("text", "Hello Zenvio", { language: "en" }),
  ];
  const bin = N.serializeNdef(records);
  assert.ok(bin.length > 10);
  const parsed = N.parseNdef(bin);
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.records[0].type, "uri");
  assert.match(parsed.records[0].value, /https:\/\/gozenvio\.com\/c\//);
  assert.equal(parsed.records[1].type, "text");
  assert.equal(parsed.records[1].value, "Hello Zenvio");
  assert.equal(N.messagesEquivalent(N.messageFromRecords(records), parsed), true);
});

test("estimates capacity and rejects empty messages", () => {
  const records = [N.recordFromEditor("tel", "+15551234567")];
  assert.ok(N.estimateNdefBytes(records) > 0);
  assert.throws(() => N.serializeNdef([]), /at least one/i);
});

test("tel mailto sms and vcard editors validate", () => {
  assert.match(N.recordFromEditor("mailto", "a@b.co").value, /^mailto:/);
  assert.match(N.recordFromEditor("sms", "+15551234567").value, /^sms:/);
  assert.match(N.recordFromEditor("vcard", "Ada", { name: "Ada Lovelace" }).value, /BEGIN:VCARD/);
  assert.throws(() => N.recordFromEditor("mailto", "not-an-email"));
});

test("smart card programming uses URI records", () => {
  const r = N.recordFromEditor("smart_card", "https://gozenvio.com/c/AbCdEfGhIjKlMnOpQrSt");
  assert.equal(r.type, "uri");
  assert.equal(r.label, "Zenvio Smart Card");
});

test("messagesEquivalent preserves Smart Card path and text case", () => {
  const a = N.messageFromRecords([N.recordFromEditor("smart_card", "https://gozenvio.com/c/AbCdEfGhIjKlMnOpQrSt")]);
  const b = N.messageFromRecords([N.recordFromEditor("smart_card", "https://gozenvio.com/c/abcdefghijklmnopqrst")]);
  assert.equal(N.messagesEquivalent(a, b), false);
  const hello = N.messageFromRecords([N.recordFromEditor("text", "Hello")]);
  const helloLower = N.messageFromRecords([N.recordFromEditor("text", "hello")]);
  assert.equal(N.messagesEquivalent(hello, helloLower), false);
  assert.equal(
    N.destinationsMatch("https://GoZenvio.com/c/AbCdEfGhIjKlMnOpQrSt", "https://gozenvio.com/c/AbCdEfGhIjKlMnOpQrSt"),
    true,
  );
  assert.equal(
    N.destinationsMatch("https://gozenvio.com/c/AbCd", "https://gozenvio.com/c/abcd"),
    false,
  );
});

test("URI and text encoders use four-byte length for payloads >= 256", () => {
  const longText = "x".repeat(300);
  const records = [N.recordFromEditor("text", longText)];
  const bin = N.serializeNdef(records);
  assert.equal(bin[0] & 0x10, 0, "SR bit must be clear for long payloads");
  const parsed = N.parseNdef(bin);
  assert.equal(parsed.records[0].value, longText);
});

test("UTF-16 text without BOM decodes as big-endian", () => {
  // Status 0x82 = UTF-16 + langLen 2; language "en"; payload U+0041 as BE 00 41
  const payload = Uint8Array.of(0x82, 0x65, 0x6e, 0x00, 0x41);
  const type = new TextEncoder().encode("T");
  const header = 0x80 | 0x40 | 0x10 | 0x01; // MB|ME|SR|TNF well-known
  const bin = Uint8Array.of(header, type.length, payload.length, ...type, ...payload);
  const parsed = N.parseNdef(bin);
  assert.equal(parsed.records[0].type, "text");
  assert.equal(parsed.records[0].value, "A");
  assert.equal(parsed.records[0].language, "en");
});

test("recordFromReadValue keeps tel mailto sms vcard and unknown without editor throws", () => {
  assert.equal(N.recordFromReadValue("uri", "tel:+15551234567").type, "tel");
  assert.equal(N.recordFromReadValue("uri", "mailto:a@b.co").type, "mailto");
  assert.equal(N.recordFromReadValue("uri", "sms:+15551234567").type, "sms");
  const vcard = N.recordFromReadValue("mime", "BEGIN:VCARD\nEND:VCARD", { mimeType: "text/vcard" });
  assert.equal(vcard.type, "vcard");
  const unknown = N.recordFromReadValue("unknown", "raw", { label: "custom" });
  assert.equal(unknown.type, "unknown");
  const msg = N.messageFromRecords([unknown]);
  assert.equal(msg.records[0].type, "unknown");
});
