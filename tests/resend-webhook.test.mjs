import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const filename = path.resolve("src/lib/resend-webhook.ts");
const mod = new Module(filename);
mod.filename = filename;
mod.paths = Module._nodeModulePaths(path.dirname(filename));
mod._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText,
  filename,
);

test("Resend webhook verification authenticates payload and rejects replay windows", () => {
  const key = randomBytes(32);
  const secret = "whsec_" + key.toString("base64");
  const payload = JSON.stringify({ type: "email.delivered" });
  const id = "msg_fixture_123456";
  const now = Date.now();
  const timestamp = String(Math.floor(now / 1000));
  const value = createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest("base64");
  assert(mod.exports.verifyResendWebhook({ payload, id, timestamp, signature: `v1,${value}`, secret, now }));
  assert(!mod.exports.verifyResendWebhook({ payload: payload + " ", id, timestamp, signature: `v1,${value}`, secret, now }));
  assert(!mod.exports.verifyResendWebhook({ payload, id, timestamp, signature: `v1,${value}`, secret, now: now + 600_000 }));
});

test("Resend event mapping distinguishes acceptance from final delivery", () => {
  assert.equal(mod.exports.resendDeliveryState("email.delivered"), "delivered");
  assert.equal(mod.exports.resendDeliveryState("email.bounced"), "bounced");
  assert.equal(mod.exports.resendDeliveryState("email.complained"), "complained");
  assert.equal(mod.exports.resendDeliveryState("email.sent"), null);
});

test("Resend webhook stores only hashed suppression addresses", () => {
  const source = fs.readFileSync("src/app/api/messaging/resend/route.ts", "utf8");
  assert.match(source, /verifyResendWebhook/);
  assert.match(source, /createHash\("sha256"\)\.update\(normalized\)/);
  assert.match(source, /insert into private\.email_suppressions\(email_hash/i);
  assert.match(source, /on conflict do nothing returning provider_event_id/i);
  const lifecycle = fs.readFileSync("src/lib/lifecycle.ts", "utf8");
  assert.match(lifecycle, /private\.email_suppressions where email_hash=\$1/i);
  assert.match(lifecycle, /provider_status='suppressed'/i);
});
