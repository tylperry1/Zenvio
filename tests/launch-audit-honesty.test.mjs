import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (f) => fs.readFileSync(f, "utf8");

test("v4 public pricing does not deep-link unenrollable plan ids while preview-only", () => {
  const v4 = read("src/components/public-pricing-v4.tsx");
  const home = read("src/app/page.tsx");
  const pricing = read("src/app/pricing/page.tsx");
  assert.match(v4, /previewOnly/);
  assert.match(v4, /enrollmentReady/);
  assert.match(v4, /Preview only — paid enrollment stays on the live catalog/);
  assert.match(v4, /Annual amounts are for planning only/);
  assert.match(v4, /const href = signupOpen \? "\/sign-up" : joinHref/);
  assert.doesNotMatch(v4, /`\/sign-up\?plan=\$\{offer\.id\}`/);
  assert.doesNotMatch(v4, /\?plan=\$\{offer\.id\}/);
  assert.match(home, /previewOnly=\{pricingSurface\.previewOnly\}/);
  assert.match(pricing, /previewOnly=\{surface\.previewOnly\}/);
});

test("billing overview discloses paused checkout when Stripe is configured", () => {
  const billing = read("src/components/billing.tsx");
  assert.match(billing, /data\.connected && !data\.checkoutEnabled/);
  assert.match(billing, /paid plan enrollment is paused/);
  assert.match(billing, /sub\.has_customer/);
  assert.match(billing, /href="\/pricing"/);
});

test("portal documents expose a recipient sign URL when available", () => {
  const api = read("src/app/api/portal/[token]/route.ts");
  const ui = read("src/components/client-portal.tsx");
  assert.match(api, /link_ciphertext/);
  assert.match(api, /sign_url/);
  assert.match(api, /sign_state/);
  assert.match(api, /waiting_on_others/);
  assert.match(api, /expires_at/);
  assert.match(api, /\/sign\/envelope#token=/);
  assert.match(ui, /Review and sign/);
  assert.match(ui, /Waiting on others/);
  assert.match(ui, /Expired/);
});

test("financial sync marks degraded or error when reconcile fails", () => {
  const sync = read("src/lib/financial-sync.ts");
  const migration = read("postgres/migrations/090_provider_sync_degraded.sql");
  assert.match(sync, /connectionStatus = failed === 0 \? "connected" : processed > 0 \? "degraded" : "error"/);
  assert.match(sync, /connection_status=\$2/);
  assert.match(migration, /'degraded'/);
  assert.match(migration, /provider_cost_sync_state_connection_status_check/);
});

test("smoke script fails on pageerror and retains them in the report", () => {
  const smoke = read("scripts/prod-launch-smoke.mjs");
  assert.match(smoke, /pageErrors\.push/);
  assert.match(smoke, /routeErrors\.length, 0/);
  assert.match(smoke, /pageErrors,/);
});

test("notifications page is titled as browser alerts and does not imply server push", () => {
  const page = read("src/components/notifications-center.tsx");
  assert.match(page, /Browser alerts/);
  assert.match(page, /Remote\s+push delivery is not available yet/);
  assert.match(page, /SMS stays provider-gated/);
});
