import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const filename = path.resolve("src/lib/twilio.ts");
const mod = new Module(filename);
mod.filename = filename;
mod.paths = Module._nodeModulePaths(path.dirname(filename));
const standard = mod.require.bind(mod);
mod.require = (id) =>
  id === "./db"
    ? { getPool: () => ({ query: async () => ({ rows: [] }) }) }
    : id === "./platform-settings"
      ? { integrationValue: async () => "" }
      : id === "./server"
        ? { ApiError: class ApiError extends Error {} }
        : standard(id);
mod._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText,
  filename,
);

test("Twilio signatures use the documented sorted-parameter algorithm", () => {
  const url = "https://gozenvio.com/api/messaging/twilio";
  const params = { To: "+15551234567", Body: "STOP", From: "+15559876543" };
  const data = url + Object.keys(params).sort().map((key) => key + params[key]).join("");
  const signature = createHmac("sha1", "fixture-token").update(data).digest("base64");
  assert.equal(mod.exports.twilioSignatureValid(url, params, signature, "fixture-token"), true);
  assert.equal(mod.exports.twilioSignatureValid(url, params, signature, "wrong-token"), false);
});

test("SMS utilities normalize destinations and enforce standard consent keywords", () => {
  assert.equal(mod.exports.normalizeE164("+1 (555) 123-4567"), "+15551234567");
  assert.throws(() => mod.exports.normalizeE164("5551234567"));
  for (const word of ["STOP", "unsubscribe", "Quit"])
    assert.equal(mod.exports.twilioKeyword(word), "stop");
  assert.equal(mod.exports.twilioKeyword("START"), "start");
  assert.equal(mod.exports.twilioKeyword("help"), "help");
  assert.equal(mod.exports.twilioKeyword("hello"), null);
});

test("migration keeps messaging private and makes provider callbacks idempotent", () => {
  const sql = fs.readFileSync("postgres/migrations/037_messaging_platform.sql", "utf8");
  assert.match(sql, /revoke all on private\.messaging_threads/i);
  assert.match(sql, /primary key\(provider,provider_event_id\)/i);
  assert.match(sql, /unique\(user_id,idempotency_key\)/i);
  assert.match(sql, /phone_e164.*\^\\\\\+/i);
  assert.match(sql, /registration_state.*unregistered.*pending.*approved.*rejected.*not_required/is);
});

test("messaging API derives tenant scope from session and marks uncertain sends for review", () => {
  const source = fs.readFileSync("src/app/api/messages/route.ts", "utf8");
  assert.match(source, /const \{ token \} = await session\(\)/);
  assert.match(source, /where user_id=\$1 and thread_id=\$2/i);
  assert.match(source, /state='sending'/i);
  assert.match(source, /idempotency_key/i);
  assert.match(source, /hourly limit reached/i);
  assert.doesNotMatch(source, /console\.log/);
});

test("public Twilio webhook authenticates before recording or processing data", () => {
  const source = fs.readFileSync("src/app/api/messaging/twilio/route.ts", "utf8");
  const signatureCheck = source.indexOf("twilioSignatureValid");
  const eventInsert = source.indexOf("provider_webhook_events");
  assert(signatureCheck >= 0 && eventInsert > signatureCheck);
  assert.match(source, /on conflict do nothing returning provider_event_id/i);
  assert.match(source, /status='opted_out'/i);
  assert.match(source, /failure_message=case when .*'SMS delivery failed\.'/i);
  assert.doesNotMatch(source, /console\.log/);
});
