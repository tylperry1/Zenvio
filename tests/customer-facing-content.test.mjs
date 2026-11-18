import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/** Customer-facing UI and product API surfaces that must not leak ops jargon. */
const SURFACES = [
  "src/components/billing.tsx",
  "src/components/enrollment.tsx",
  "src/components/billing-addons.tsx",
  "src/components/notifications-center.tsx",
  "src/components/assistant.tsx",
  "src/components/auth-form.tsx",
  "src/components/client-portal.tsx",
  "src/components/commerce/growth-center.tsx",
  "src/components/commerce/storefront.tsx",
  "src/components/video-meetings.tsx",
  "src/components/payment-center.tsx",
  "src/components/pricing-allowances.tsx",
  "src/components/google-calendar-connection.tsx",
  "src/lib/customer-messages.ts",
  "src/app/api/billing/route.ts",
  "src/app/api/subscription-enroll/route.ts",
  "src/app/api/auth/route.ts",
  "src/app/api/appointment-payments/route.ts",
  "src/lib/appointment-payments.ts",
  "src/lib/google-calendar.ts",
  "src/lib/video.ts",
];

const FORBIDDEN = [
  /Stripe is configured/i,
  /checkout readiness/i,
  /paid plan enrollment is paused/i,
  /Sync plan to Stripe/i,
  /webhook signing secret/i,
  /sandbox acceptance/i,
  /environment variable/i,
  /feature flag/i,
  /Anthropic API key/i,
  /Admin → Operations/i,
  /Resend lifecycle queue/i,
  /provider-gated/i,
  /platform owner/i,
  /master admin/i,
  /Pricing v4/i,
  /Stripe price mappings/i,
  /not configured by the platform/i,
  /setup is required in master admin/i,
  /platform administrator needs to finish/i,
  /Purchasing is not yet enabled/i,
  /Waiting on platform setup/i,
  /Checkout activation remains independently controlled/i,
  /Stripe confirmed cancellation at period end/i,
  /Stripe billing is not connected yet/i,
];

test("customer-facing surfaces avoid internal development and configuration language", () => {
  const hits = [];
  for (const file of SURFACES) {
    const full = path.join(process.cwd(), file);
    assert.ok(fs.existsSync(full), `missing ${file}`);
    const text = fs.readFileSync(full, "utf8");
    for (const pattern of FORBIDDEN) {
      if (pattern.test(text)) hits.push(`${file} ↔ ${pattern}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("customer message catalog covers billing enrollment and auth recovery", () => {
  const messages = fs.readFileSync("src/lib/customer-messages.ts", "utf8");
  const values = [...messages.matchAll(/"([^"\\]|\\.)*"/g)].map((m) => m[0]);
  const joined = values.join("\n");
  assert.match(messages, /enrollmentPaused/);
  assert.match(messages, /enrollmentPausedWithBillingAccount/);
  assert.match(messages, /enrollmentPausedTeamMember/);
  assert.match(messages, /resetEmailUnavailable/);
  assert.match(messages, /assistant/);
  assert.doesNotMatch(joined, /webhook/i);
  assert.doesNotMatch(joined, /sandbox/i);
  assert.doesNotMatch(joined, /API key/i);
});
