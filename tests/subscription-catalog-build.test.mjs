import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("disabled checkout skips catalog writes before opening a database connection", () => {
  const result = spawnSync(process.execPath, ["scripts/provision-subscription-packages.mjs"], {
    encoding: "utf8",
    env: {
      ...process.env,
      VERCEL_ENV: "production",
      DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/never_connect",
      DATABASE_URL_UNPOOLED: "",
      BILLING_CHECKOUT_ENABLED: "false",
      BILLING_CATALOG_SYNC_ENABLED: "false",
    },
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /catalog synchronization was not requested/);
});
