import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("src/app/api/admin/provider-health/route.ts", "utf8");

test("provider health is master-admin-only and never selects stored credentials", () => {
  assert.match(source, /await adminSession\(\)/);
  assert.match(source, /sameOrigin\(request\)/);
  assert.doesNotMatch(source, /integration_secrets/i);
  assert.doesNotMatch(source, /ciphertext|auth_token|access_token/i);
});

test("critical recovery actions require explicit confirmations and produce audit records", () => {
  assert.match(source, /RETRY_FAILED_EMAILS/);
  assert.match(source, /RETRY_CALENDAR_SYNC/);
  assert.match(source, /private\.operation_log/);
  assert.match(source, /provider_id is null/i);
});

test("US messaging activation requires a completed registration state", () => {
  assert.match(source, /country === "US"/);
  assert.match(source, /\["approved", "not_required"\]\.includes\(state\)/);
  assert.match(source, /messaging_enabled/);
});
