import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("the retired v3 catalog provisioner no longer exists or runs during builds", () => {
  assert.equal(fs.existsSync("scripts/provision-subscription-packages.mjs"), false);
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.doesNotMatch(pkg.scripts.build, /provision-subscription-packages/);
  assert.match(pkg.scripts.build, /scripts\/migrate\.mjs/);
  assert.match(pkg.scripts.build, /next build/);
});

test("catalog synchronization is an explicit script, not part of the build", () => {
  const script = fs.readFileSync("scripts/sync-stripe-catalog.mjs", "utf8");
  assert.match(script, /BILLING_STRIPE_SYNC/);
  assert.match(script, /BILLING_LIVE_SYNC_APPROVED/);
  assert.doesNotMatch(script, /PRICING_V4|pricing_v4/);
});
