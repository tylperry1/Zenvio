import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const read = (file) => fs.readFileSync(file, "utf8");

function load(file, deps = {}) {
  const filename = path.resolve(file);
  const m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = m.require.bind(m);
  m.require = (id) => (Object.hasOwn(deps, id) ? deps[id] : original(id));
  m._compile(
    ts.transpileModule(read(file), {
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

class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const v4 = load("src/lib/pricing-catalog.mjs");
const policy = load("src/lib/entitlement-policy.ts", {
  "./pricing-catalog.mjs": v4,
});
const entitlements = load("src/lib/entitlements.ts", {
  "./db": { getPool: () => ({}) },
  "./server": { ApiError },
  "./envelope-usage": { envelopeBudget: async () => ({ sent: 0, included: 12 }) },
  "./entitlement-policy": policy,
});
const addons = load("src/lib/subscription-addons.ts", { "./server": { ApiError } });
const stripeEnvironment = load("src/lib/stripe-environment.ts");
const webhook = load("src/lib/stripe-webhook.ts");

/* CR-01 — Stripe live/test boundary */

test("Stripe keys are bound to the deployment environment", () => {
  assert.equal(stripeEnvironment.stripeKeyMode("sk_test_synthetic"), "test");
  assert.equal(stripeEnvironment.stripeKeyMode("rk_test_synthetic"), "test");
  assert.equal(stripeEnvironment.stripeKeyMode("sk_live_synthetic"), "live");
  assert.equal(stripeEnvironment.stripeKeyMode("rk_live_synthetic"), "live");
  assert.equal(stripeEnvironment.stripeKeyMode("pk_live_public"), "unknown");
  assert.equal(stripeEnvironment.stripeKeyMode(""), "unknown");

  assert.equal(
    stripeEnvironment.stripeDeploymentEnvironment({ VERCEL_ENV: "production" }),
    "production",
  );
  assert.equal(stripeEnvironment.stripeDeploymentEnvironment({ VERCEL_ENV: "preview" }), "preview");
  assert.equal(
    stripeEnvironment.stripeDeploymentEnvironment({ VERCEL_ENV: "development" }),
    "development",
  );
  // An explicit pin wins over ambient platform metadata.
  assert.equal(
    stripeEnvironment.stripeDeploymentEnvironment({
      VERCEL_ENV: "production",
      STRIPE_BILLING_ENV: "preview",
    }),
    "preview",
  );
  // A production Node runtime outside Vercel cannot be a preview.
  assert.equal(
    stripeEnvironment.stripeDeploymentEnvironment({ NODE_ENV: "production" }),
    "production",
  );
  assert.equal(stripeEnvironment.stripeDeploymentEnvironment({ NODE_ENV: "test" }), "development");

  assert.equal(stripeEnvironment.stripeKeyProblem("live", "production"), null);
  assert.equal(
    stripeEnvironment.stripeKeyProblem("test", "production"),
    "Production billing requires a live Stripe secret key.",
  );
  assert.equal(stripeEnvironment.stripeKeyProblem("test", "preview"), null);
  assert.equal(
    stripeEnvironment.stripeKeyProblem("live", "preview"),
    "Non-production billing requires a Stripe test-mode secret key.",
  );
  assert.equal(
    stripeEnvironment.stripeKeyProblem("live", "development"),
    "Non-production billing requires a Stripe test-mode secret key.",
  );
  assert.match(stripeEnvironment.stripeKeyProblem("unknown", "production"), /not a recognizable/);
});

test("webhook deliveries must match the configured Stripe mode", () => {
  assert.equal(stripeEnvironment.stripeEventModeProblem(false, "test"), null);
  assert.equal(stripeEnvironment.stripeEventModeProblem(true, "live"), null);
  assert.match(stripeEnvironment.stripeEventModeProblem(false, "live"), /does not match/);
  assert.match(stripeEnvironment.stripeEventModeProblem(true, "test"), /does not match/);
  assert.match(stripeEnvironment.stripeEventModeProblem(undefined, "live"), /does not declare/);
  assert.match(stripeEnvironment.stripeEventModeProblem(true, "unknown"), /unknown/);
});

test("billing and the live webhook route enforce the Stripe boundary", () => {
  const billing = read("src/lib/billing.ts");
  assert.match(
    billing,
    /stripeKeyProblem\(stripeKeyMode\(key\), stripeDeploymentEnvironment\(\)\)/,
  );
  assert.match(billing, /throw unavailable\(\)/);
  const readiness = read("src/lib/billing-readiness.ts");
  assert.match(readiness, /Stripe credentials don.t match this deployment environment/);
  const route = read("src/app/api/billing/webhook/route.ts");
  assert.match(route, /stripeEventModeProblem\(event\.livemode, await stripeEnvironment\(\)\)/);
  assert.match(route, /Webhook environment mismatch/);
});

/* CR-02 — paid after an expiry delivery */

function addonOrder(overrides = {}) {
  return {
    id: "order_1",
    checkout_id: "cs_1",
    customer_id: "cus_1",
    billing_owner: "owner_1",
    amount_cents: 999,
    quantity: 100,
    meter: "aiCredits",
    state: "pending",
    refunded_cents: 0,
    reversed_credits: 0,
    ...overrides,
  };
}

function addonCheckout(overrides = {}) {
  return {
    id: "cs_1",
    customer: "cus_1",
    client_reference_id: "owner_1",
    mode: "payment",
    currency: "usd",
    amount_total: 999,
    payment_status: "paid",
    status: "complete",
    payment_intent: "pi_1",
    metadata: { zenvio_addon_order: "order_1" },
    ...overrides,
  };
}

function addonDb(order) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/from private\.subscription_addon_orders where id=\$1 for update/i.test(sql))
        return { rows: [order] };
      return { rows: [] };
    },
  };
}

const creditGrants = (db) =>
  db.queries.filter((q) => /insert into private\.subscription_credit_entries/i.test(q.sql)).length;
const markedPaid = (db) =>
  db.queries.filter((q) => /set state='paid'/i.test(q.sql)).length;

test("a verified paid session settles an add-on that was already marked expired", async () => {
  const db = addonDb(addonOrder({ state: "expired" }));
  assert.equal(await addons.settleAddon(db, addonCheckout()), true);
  assert.equal(creditGrants(db), 1);
  assert.equal(markedPaid(db), 1);
});

test("an expired add-on stays unpaid without provider proof", async () => {
  const db = addonDb(addonOrder({ state: "expired" }));
  await assert.rejects(
    addons.settleAddon(db, addonCheckout({ status: "expired", payment_status: "unpaid" })),
    /could not be verified/,
  );
  assert.equal(creditGrants(db), 0);
  assert.equal(markedPaid(db), 0);
});

test("a retried failed payment grants once, and refunded orders never re-grant", async () => {
  const retry = addonDb(addonOrder({ state: "failed" }));
  assert.equal(await addons.settleAddon(retry, addonCheckout()), true);
  assert.equal(creditGrants(retry), 1);
  const refunded = addonDb(addonOrder({ state: "refunded" }));
  assert.equal(await addons.settleAddon(refunded, addonCheckout()), true);
  assert.equal(creditGrants(refunded), 0);
});

function webhookDeps(order) {
  const calls = { settle: 0, refund: 0, save: 0 };
  const client = {
    release() {},
    async query(sql) {
      if (sql.includes("SELECT checkout_id,state FROM private.subscription_addon_orders"))
        return { rows: order ? [order] : [] };
      if (sql.includes("SELECT status FROM private.stripe_webhook_events")) return { rows: [] };
      return { rows: [] };
    },
  };
  return {
    calls,
    deps: {
      connect: async () => client,
      stripe: {
        checkout: {
          sessions: { retrieve: async () => ({ id: order?.checkout_id ?? "cs_1", payment_intent: null }) },
        },
        paymentIntents: { retrieve: async () => ({ id: "pi_1", latest_charge: null }) },
        charges: { retrieve: async () => ({ id: "ch_1" }) },
      },
      saveSubscription: async () => {
        calls.save += 1;
      },
      settleAddon: async () => {
        calls.settle += 1;
        return true;
      },
      refundAddon: async () => {
        calls.refund += 1;
        return true;
      },
      failAddon: async () => true,
      failAddonPayment: async () => true,
    },
  };
}

test("an expiry delivery that lands before the payment does not block settlement", async () => {
  for (const state of ["pending", "failed", "expired"]) {
    const { deps, calls } = webhookDeps({ checkout_id: "cs_1", state });
    const result = await webhook.processStripeEvent(
      {
        id: "evt_pi_" + state,
        type: "payment_intent.succeeded",
        data: { object: { id: "pi_1", metadata: { zenvio_addon_order: "order_1" } } },
      },
      deps,
    );
    assert.equal(result.outcome, "processed", state);
    assert.equal(calls.settle, 1, state);
  }
});

test("an already settled or refunded add-on is never settled again", async () => {
  for (const state of ["paid", "refunded", "partially_refunded"]) {
    const { deps, calls } = webhookDeps({ checkout_id: "cs_1", state });
    const result = await webhook.processStripeEvent(
      {
        id: "evt_pi_" + state + "_again",
        type: "payment_intent.succeeded",
        data: { object: { id: "pi_1", metadata: { zenvio_addon_order: "order_1" } } },
      },
      deps,
    );
    assert.equal(result.outcome, "ignored", state);
    assert.equal(calls.settle, 0, state);
  }
});

/* CR-03 — a legacy grant never borrows a newer subscription catalog */

function entitlementDb(row) {
  return {
    async query(sql) {
      if (sql.includes('FROM public."user" u')) return { rows: [row] };
      if (sql.includes("team_entitlement_roots")) return { rows: [] };
      if (sql.includes("FROM public.event_types"))
        return {
          rows: [{ types: 0, calendars: 0, envelopes: 0, workflows: 0, contacts: 0 }],
        };
      if (sql.includes("private.platform_roles")) return { rows: [] };
      return { rows: [] };
    },
  };
}

test("an active grant owns its catalog version", () => {
  assert.equal(entitlements.effectiveCatalogVersion("business", null, "2026-11-v4"), null);
  assert.equal(
    entitlements.effectiveCatalogVersion("business", "2026-11-v4", "2026-11-v3"),
    "2026-11-v4",
  );
  assert.equal(entitlements.effectiveCatalogVersion(null, null, "2026-11-v4"), "2026-11-v4");
  assert.equal(entitlements.effectiveCatalogVersion(undefined, "2026-11-v4", null), null);
});

test("a Business grant keeps Team limits and seats", async () => {
  const state = await entitlements.entitlementUsage(
    "u1",
    entitlementDb({
      plan: "business",
      status: "active",
      seats: 1,
      catalog_version: "2026-11-v4",
      override_plan: "business",
      override_catalog_version: null,
      effective_plan: "business",
    }),
  );
  assert.equal(state.catalogVersion, "legacy");
  assert.equal(state.plan, "business");
  assert.equal(state.seats, 3);
  assert.equal(state.limits.types, 100000);
  assert.equal(state.limits.contacts, 30000);
});

test("a v4 Team grant keeps v4 Team seats and limits", async () => {
  const state = await entitlements.entitlementUsage(
    "u2",
    entitlementDb({
      plan: "business",
      status: "active",
      seats: 1,
      catalog_version: null,
      override_plan: "business",
      override_catalog_version: "2026-11-v4",
      effective_plan: "business",
    }),
  );
  assert.equal(state.catalogVersion, "2026-11-v4");
  assert.equal(state.seats, 3);
  assert.equal(state.limits.types, 100000);
  assert.equal(state.limits.contacts, 30000);
});

test("migration 106 identifies only the canonical state constraint", () => {
  const migration = read("postgres/migrations/106_billing_webhook_terminal_states.sql");
  // CR-08: no pattern-based discovery or dynamic drop. The only pattern query is
  // the fail-closed drift check that raises instead of dropping.
  assert.doesNotMatch(migration, /EXECUTE format/);
  assert.doesNotMatch(migration, /SELECT conname INTO/);
  assert.match(migration, /ILIKE '%state%'/);
  assert.match(migration, /conname = 'subscription_addon_orders_state_check'/);
  assert.match(migration, /DROP CONSTRAINT subscription_addon_orders_state_check/);
  assert.match(migration, /RAISE EXCEPTION/);
  assert.match(
    migration,
    /CHECK \(state IN \('pending','paid','refunded','partially_refunded','failed','expired'\)\)/,
  );
  const rollback = read("postgres/rollback/106_billing_webhook_terminal_states_down.sql");
  assert.match(rollback, /DROP CONSTRAINT IF EXISTS subscription_addon_orders_state_check/);
  assert.match(rollback, /Cannot roll back 106/);
});

test("a legacy Pro grant does not inherit the subscription's v4 catalog", async () => {
  const state = await entitlements.entitlementUsage(
    "u3",
    entitlementDb({
      plan: "professional",
      status: "active",
      seats: 1,
      catalog_version: "2026-11-v4",
      override_plan: "pro",
      override_catalog_version: null,
      effective_plan: "pro",
    }),
  );
  assert.equal(state.catalogVersion, "legacy");
  assert.equal(state.plan, "pro");
  assert.equal(state.seats, 1);
  assert.equal(state.limits.types, 100000);
});
