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
  assert.match(v4, /These plans aren’t open for paid signup yet/);
  assert.match(v4, /Annual totals are shown for planning/);
  assert.match(v4, /monthly allowances are still granted each month/i);
  assert.match(v4, /const href = signupOpen \? "\/sign-up" : joinHref/);
  assert.doesNotMatch(v4, /`\/sign-up\?plan=\$\{offer\.id\}`/);
  assert.doesNotMatch(v4, /\?plan=\$\{offer\.id\}/);
  assert.match(home, /previewOnly=\{pricingSurface\.previewOnly\}/);
  assert.match(pricing, /previewOnly=\{surface\.previewOnly\}/);
});

test("billing overview uses customer-safe paused-enrollment copy without Stripe readiness internals", () => {
  const billing = read("src/components/billing.tsx");
  const messages = read("src/lib/customer-messages.ts");
  // The paused notice follows the same enrollment gate the plans tab uses: v4
  // reads the public surface, legacy reads the checkout flag.
  assert.match(billing, /data\.connected && !enrollmentOpen/);
  assert.match(
    billing,
    /d\.pricingSurface\?\.family === "v4" \? d\.pricingSurface\.enrollment\.enabled : d\.checkoutEnabled/,
  );
  assert.match(billing, /customerMessages\.billing\.enrollmentPaused/);
  assert.match(billing, /customerMessages\.billing\.enrollmentPausedWithBillingAccount/);
  assert.match(billing, /customerMessages\.billing\.enrollmentPausedTeamMember/);
  assert.match(messages, /enrollmentPaused:\s*\n\s*"Online plan enrollment isn’t open right now/);
  assert.match(billing, /sub\.has_customer/);
  assert.match(billing, /href="\/pricing"/);
  assert.doesNotMatch(billing, /Stripe is configured/);
  assert.doesNotMatch(billing, /checkout readiness/);
  assert.doesNotMatch(billing, /paid plan enrollment is paused/);
  assert.doesNotMatch(billing, /Sync plan to Stripe/);
  assert.doesNotMatch(billing, /master admin/);
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

test("notifications page is titled as browser alerts and avoids internal delivery jargon", () => {
  const page = read("src/components/notifications-center.tsx");
  assert.match(page, /Browser alerts/);
  assert.match(page, /where available, SMS/);
  assert.match(page, /Automations and your[\s\S]*service settings/);
  assert.doesNotMatch(page, /Resend lifecycle queue/);
  assert.doesNotMatch(page, /provider-gated/);
  assert.doesNotMatch(page, /Remote\s+push delivery is not available yet/);
  assert.doesNotMatch(page, /remote push endpoint/);
  // Implementation may still register a SW; customer-visible copy must not mention it.
  assert.doesNotMatch(page, /registers the existing Zenvio service worker/);
});

test("assistant unavailable state does not expose Anthropic admin setup instructions", () => {
  const assistant = read("src/components/assistant.tsx");
  const messages = read("src/lib/customer-messages.ts");
  assert.match(assistant, /customerMessages\.assistant\.notReadyTitle/);
  assert.match(assistant, /customerMessages\.assistant\.notReadyBody/);
  assert.match(messages, /notReadyTitle:\s*"The assistant isn’t available yet"/);
  assert.doesNotMatch(assistant, /Anthropic API key/);
  assert.doesNotMatch(assistant, /Admin → Operations/);
});
