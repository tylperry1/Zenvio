import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

function load(file, deps = {}) {
  const filename = path.resolve(file);
  const m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = m.require.bind(m);
  m.require = (id) => (Object.hasOwn(deps, id) ? deps[id] : original(id));
  m._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );
  return m.exports;
}

const v4 = load("src/lib/pricing-v4-catalog.mjs");

test("official catalog amounts match the approved USD pricing", () => {
  const byId = Object.fromEntries(v4.pricingV4Offers.map((offer) => [offer.id, offer]));
  assert.deepEqual(
    { monthly: byId.free.monthly, annual: byId.free.annual },
    { monthly: 0, annual: 0 },
  );
  assert.deepEqual(
    { monthly: byId.starter.monthly, annual: byId.starter.annual },
    { monthly: 999, annual: 9588 },
  );
  assert.deepEqual(
    { monthly: byId.professional.monthly, annual: byId.professional.annual },
    { monthly: 1999, annual: 19188 },
  );
  assert.deepEqual(
    { monthly: byId.business.monthly, annual: byId.business.annual },
    { monthly: 3499, annual: 33588 },
  );
  assert.equal(byId.enterprise.monthly, null);
  assert.equal(byId.enterprise.annual, null);
  assert.equal(v4.pricingV4Flagship, "professional");
});

test("official included allowances match the approved catalog", () => {
  const a = v4.pricingV4Allowances;
  assert.deepEqual(
    {
      contacts: a.free.contacts,
      storage: a.free.storageBytes,
      marketing: a.free.marketingEmails,
      automation: a.free.automationExecutions,
      ai: a.free.aiCredits,
      envelopes: a.free.envelopes,
      bookings: a.free.appointments,
    },
    {
      contacts: 100,
      storage: 100 * 1024 * 1024,
      marketing: 0,
      automation: 0,
      ai: 0,
      envelopes: 0,
      bookings: 30,
    },
  );
  assert.deepEqual(
    [a.starter.contacts, a.starter.storageBytes, a.starter.marketingEmails, a.starter.automationExecutions, a.starter.aiCredits, a.starter.envelopes, a.starter.appointments],
    [1000, 1024 ** 3, 250, 100, 25, 5, null],
  );
  assert.deepEqual(
    [a.professional.contacts, a.professional.storageBytes, a.professional.marketingEmails, a.professional.automationExecutions, a.professional.aiCredits, a.professional.envelopes, a.professional.appointments],
    [10000, 5 * 1024 ** 3, 2000, 1000, 200, 20, null],
  );
  assert.deepEqual(
    [a.business.contacts, a.business.storageBytes, a.business.marketingEmails, a.business.automationExecutions, a.business.aiCredits, a.business.envelopes, a.business.appointments],
    [30000, 15 * 1024 ** 3, 5000, 3000, 500, 50, null],
  );
});

test("annual plans expose an exact monthly equivalent and stable internal ids", () => {
  assert.equal(v4.pricingV4PlanIds.starter, "starter");
  assert.equal(v4.pricingV4PlanIds.team, "business");
  assert.equal(v4.pricingV4AnnualMonthlyEquivalent({ annual: 9588 }), 799);
  assert.equal(v4.pricingV4AnnualMonthlyEquivalent({ annual: 19188 }), 1599);
  assert.equal(v4.pricingV4AnnualMonthlyEquivalent({ annual: 33588 }), 2799);
  assert.equal(v4.pricingV4AnnualMonthlyEquivalent({ annual: null }), null);
});

test("usage periods stay monthly for annual subscribers", () => {
  const usage = fs.readFileSync("src/lib/subscription-usage.ts", "utf8");
  assert.match(usage, /period=date_trunc\('month',now\(\) at time zone 'UTC'\)::date/);
  assert.doesNotMatch(usage, /annual/i);
});

test("Stripe metadata uses stable identifiers, interval, environment, and catalog version", () => {
  const metadata = v4.pricingV4StripeMetadata({
    planId: "professional",
    interval: "annual",
    environment: "test",
    catalogVersion: v4.pricingV4Version,
  });
  assert.equal(metadata.zenvio_plan_id, "professional");
  assert.equal(metadata.zenvio_billing_interval, "annual");
  assert.equal(metadata.zenvio_environment, "test");
  assert.equal(metadata.zenvio_catalog_version, v4.pricingV4Version);
  assert.equal(metadata.zenvio_offer, "professional");
  assert.equal(v4.stripeEnvironmentForKey("sk_test_synthetic"), "test");
  assert.equal(v4.stripeEnvironmentForKey("sk_live_synthetic"), "live");
  assert.equal(v4.stripeEnvironmentForKey(""), "unknown");
});

test("public comparison and pricing copy come from the catalog, not hardcoded values", () => {
  const component = fs.readFileSync("src/components/public-pricing-v4.tsx", "utf8");
  assert.match(component, /pricingV4Allowances/);
  assert.match(component, /pricingV4Offers/);
  assert.match(component, /storageBytes/);
  assert.match(component, /appointments/);
  assert.match(component, /Annual subscribers receive the same monthly allowance each month/);
  assert.doesNotMatch(component, /\$19\.99|\$9\.99|\$34\.99/);

  const early = fs.readFileSync("src/app/early-access/page.tsx", "utf8");
  assert.doesNotMatch(early, /29\.99|49\.99/);
  const mail = fs.readFileSync("src/lib/early-access-mail.ts", "utf8");
  assert.doesNotMatch(mail, /29\.99|49\.99/);
});

function webhookFixture(state = {}) {
  const calls = { save: [], settle: 0, refund: 0 };
  const client = {
    released: false,
    release() {
      this.released = true;
    },
    async query(sql) {
      if (sql.includes("SELECT status FROM private.stripe_webhook_events"))
        return { rows: state.eventRow ? [{ status: state.eventRow.status }] : [] };
      if (sql.includes("INSERT INTO private.stripe_webhook_events")) return { rows: [] };
      if (sql.includes("UPDATE private.stripe_webhook_events")) return { rows: [] };
      if (sql.includes("INSERT INTO private.stripe_events")) return { rows: [] };
      if (sql.includes("SELECT user_id FROM private.subscriptions"))
        return { rows: state.owner ? [{ user_id: state.owner }] : [] };
      if (sql.includes("SELECT checkout_id,state FROM private.subscription_addon_orders"))
        return { rows: state.order ? [state.order] : [] };
      if (sql.includes("SELECT id FROM private.subscription_addon_orders"))
        return { rows: state.orderId ? [{ id: state.orderId }] : [] };
      return { rows: [] };
    },
  };
  const stripe = {
    subscriptions: {
      async retrieve(id) {
        if (state.missingSubscription) {
          const error = new Error("missing");
          error.code = "resource_missing";
          throw error;
        }
        return {
          id,
          customer: "cus_fixture",
          status: state.subscriptionStatus || "active",
          metadata: { user_id: state.metadataUser ?? state.owner ?? "owner" },
          items: { data: [] },
          discounts: [],
        };
      },
    },
    checkout: {
      sessions: { async retrieve() { return state.checkout || { id: "cs_fixture" }; } },
    },
    paymentIntents: {
      async retrieve() { return state.intent || { id: "pi_fixture", latest_charge: null }; },
    },
    charges: { async retrieve() { return state.charge || { id: "ch_fixture" }; } },
    invoices: { async retrieve() { return state.invoice || { id: "in_fixture" }; } },
    customers: { async retrieve() { return state.customer || { id: "cus_fixture" }; } },
  };
  const deps = {
    connect: async () => client,
    stripe,
    saveSubscription: async (_client, subscription, userId) => {
      calls.save.push({ id: subscription.id, status: subscription.status, userId });
    },
    settleAddon: async () => {
      calls.settle += 1;
      return true;
    },
    refundAddon: async () => {
      calls.refund += 1;
      return true;
    },
  };
  return { deps, calls };
}

const webhook = load("src/lib/stripe-webhook.ts");

test("duplicate Stripe deliveries never apply subscription changes twice", async () => {
  const { deps, calls } = webhookFixture({ eventRow: { status: "processed" }, owner: "owner" });
  const result = await webhook.processStripeEvent(
    { id: "evt_duplicate", type: "customer.subscription.updated", data: { object: { id: "sub_1" } } },
    deps,
  );
  assert.equal(result.duplicate, true);
  assert.equal(calls.save.length, 0);
});

test("invoice payment failure records the live past_due subscription, not a claimed payment", async () => {
  const { deps, calls } = webhookFixture({
    owner: "owner",
    subscriptionStatus: "past_due",
  });
  const result = await webhook.processStripeEvent(
    {
      id: "evt_invoice_failed",
      type: "invoice.payment_failed",
      data: { object: { id: "in_1", subscription: "sub_1" } },
    },
    deps,
  );
  assert.equal(result.outcome, "processed");
  assert.equal(calls.save.length, 1);
  assert.equal(calls.save[0].status, "past_due");
});

test("invoice events resolve the subscription from the newer parent field", async () => {
  const { deps, calls } = webhookFixture({ owner: "owner", subscriptionStatus: "past_due" });
  const result = await webhook.processStripeEvent(
    {
      id: "evt_invoice_parent",
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_2",
          parent: { subscription_details: { subscription: "sub_2" } },
        },
      },
    },
    deps,
  );
  assert.equal(result.outcome, "processed");
  assert.equal(calls.save.length, 1);
  assert.equal(calls.save[0].id, "sub_2");
});

test("subscription ownership mismatch fails closed and is recorded as failed", async () => {
  const { deps, calls } = webhookFixture({ owner: "owner", metadataUser: "someone_else" });
  await assert.rejects(
    webhook.processStripeEvent(
      { id: "evt_foreign", type: "customer.subscription.updated", data: { object: { id: "sub_1" } } },
      deps,
    ),
    /ownership/i,
  );
  assert.equal(calls.save.length, 0);
});

test("payment intent fulfillment requires the pending stored checkout", async () => {
  const pending = webhookFixture({ order: { checkout_id: "cs_fixture", state: "pending" } });
  const paid = await webhook.processStripeEvent(
    {
      id: "evt_pi_pending",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_1", metadata: { zenvio_addon_order: "order_1" } } },
    },
    pending.deps,
  );
  assert.equal(paid.outcome, "processed");
  assert.equal(pending.calls.settle, 1);

  const alreadyPaid = webhookFixture({ order: { checkout_id: "cs_fixture", state: "paid" } });
  const skipped = await webhook.processStripeEvent(
    {
      id: "evt_pi_paid",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_1", metadata: { zenvio_addon_order: "order_1" } } },
    },
    alreadyPaid.deps,
  );
  assert.equal(skipped.outcome, "ignored");
  assert.equal(alreadyPaid.calls.settle, 0);
});

test("webhook events outside Zenvio billing are ignored without failing", async () => {
  const { deps, calls } = webhookFixture({});
  const result = await webhook.processStripeEvent(
    { id: "evt_unknown", type: "customer.created", data: { object: { id: "cus_1" } } },
    deps,
  );
  assert.equal(result.outcome, "ignored");
  assert.equal(calls.save.length, 0);
});

test("SMS metering splits included allowance from billable overage exactly once", async () => {
  const state = { includedUsed: 0, rows: new Map() };
  const db = {
    async query(sql, params) {
      if (sql.includes("coalesce(sum(included_quantity)"))
        return { rows: [{ n: String(state.includedUsed) }] };
      if (sql.includes("INSERT INTO private.subscription_usage_reservations")) {
        const reference = params[2];
        if (state.rows.has(reference)) return { rows: [] };
        state.rows.set(reference, { segments: params[3], included: params[4] });
        state.includedUsed += Number(params[4]);
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  const usage = load("src/lib/sms-usage.ts", {
    "./launch/telnyx": { smsSegments: (text) => (text.length <= 160 ? 1 : Math.ceil(text.length / 160)) },
    "./subscription-usage": {
      usageOwner: async () => "owner",
      subscriptionUsage: async () => ({
        meters: [{ meter: "smsSegments", included: 300, unlimited: false }],
      }),
    },
    "./db": { getPool: () => ({}) },
  });
  assert.equal(usage.billableSmsSegments("hello"), 1);
  assert.equal(usage.billableSmsSegments("x".repeat(161)), 2);
  assert.equal(usage.billableSmsSegments("   "), 0);

  const first = await usage.recordSmsSegments(db, {
    userId: "user",
    outboxId: "outbox_1",
    text: "a".repeat(320),
  });
  assert.deepEqual(first, { segments: 2, included: 2, overage: 0 });

  const second = await usage.recordSmsSegments(db, {
    userId: "user",
    outboxId: "outbox_2",
    text: "b".repeat(320),
  });
  assert.deepEqual(second, { segments: 2, included: 2, overage: 0 });

  const repeat = await usage.recordSmsSegments(db, {
    userId: "user",
    outboxId: "outbox_2",
    text: "b".repeat(320),
  });
  // Replays are idempotent by outbox reference.
  assert.equal(repeat.included, 2);
  assert.equal(state.rows.size, 2);
});
