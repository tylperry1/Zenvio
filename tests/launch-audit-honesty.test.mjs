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
  assert.match(v4, /canEnroll && signupOpen/);
  assert.match(v4, /canEnroll && signupOpen\s*\?\s*`\/sign-up\?plan=\$\{offer\.id\}`/);
  assert.doesNotMatch(v4, /:\s*signupOpen\s*\?\s*`\/sign-up\?plan=\$\{offer\.id\}`/);
  assert.match(home, /previewOnly=\{pricingSurface\.previewOnly\}/);
  assert.match(pricing, /previewOnly=\{surface\.previewOnly\}/);
});

test("billing overview discloses paused checkout when Stripe is configured", () => {
  const billing = read("src/components/billing.tsx");
  assert.match(billing, /data\.connected && !data\.checkoutEnabled/);
  assert.match(billing, /paid plan enrollment is paused/);
});

test("portal documents expose a recipient sign URL when available", () => {
  const api = read("src/app/api/portal/[token]/route.ts");
  const ui = read("src/components/client-portal.tsx");
  assert.match(api, /link_ciphertext/);
  assert.match(api, /sign_url/);
  assert.match(api, /\/sign\/envelope#token=/);
  assert.match(ui, /Review and sign/);
  assert.match(ui, /d\.sign_url/);
});

test("financial sync marks degraded or error when reconcile fails", () => {
  const sync = read("src/lib/financial-sync.ts");
  assert.match(sync, /connectionStatus = failed === 0 \? "connected" : processed > 0 \? "degraded" : "error"/);
  assert.match(sync, /connection_status=\$2/);
});

test("notifications page is titled as browser alerts and does not imply server push", () => {
  const page = read("src/components/notifications-center.tsx");
  assert.match(page, /Browser alerts/);
  assert.match(page, /Remote\s+push delivery is not available yet/);
  assert.match(page, /SMS stays provider-gated/);
});
