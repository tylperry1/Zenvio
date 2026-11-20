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
