import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const read = (file) => fs.readFileSync(file, "utf8");

// v4 enrollment in this fixture is gated by the validated-catalog flag.
process.env.BILLING_VALIDATED = "true";

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
const plans = load("src/lib/plan-display.ts");
const preview = load("src/lib/subscription-preview.ts", {
  "./server": { ApiError },
  "./pricing-catalog.mjs": v4,
});

const PERIOD_END = 1900000000;

/* ---------- request resolution ---------- */

test("v4 change resolution validates plan, interval, and Team seats", () => {
  const starter = preview.resolveChangeRequest({
    plan: "starter",
    period: "annual",
    seats: 1
  });
  assert.equal(starter.period, "annual");
  assert.equal(starter.catalogVersion, v4.CATALOG_ID);
  assert.deepEqual(starter.requested, [{ plan: "starter", quantity: 1 }]);

  const team = preview.resolveChangeRequest({
    plan: "business",
    period: "monthly",
    seats: 5
  });
  assert.equal(team.seats, 5);
  assert.deepEqual(team.requested, [
    { plan: "business", quantity: 1 },
    { plan: "business_extra", quantity: 2 },
  ]);

  const three = preview.resolveChangeRequest({
    plan: "business",
    period: "monthly",
    seats: 3
  });
  assert.deepEqual(three.requested, [{ plan: "business", quantity: 1 }]);
});

test("invalid seat counts and unpublished plans are refused", () => {
  for (const seats of [2, 3.5, 1001, "three"]) {
    assert.throws(
      () =>
        preview.resolveChangeRequest({
          plan: "business",
          period: "monthly",
          seats
        }),
      /valid number of seats/,
    );
  }
  assert.equal(
    preview.resolveChangeRequest({ plan: "individual", period: "annual", seats: 1 }).plan,
    "starter",
  );
  assert.throws(
    () =>
      preview.resolveChangeRequest({
        plan: "enterprise",
        period: "monthly",
        seats: 1,
      }),
    /Starter, Professional, or Team/,
  );
});

test("retired plan ids resolve to the current catalogue and seat lines", () => {
  const change = preview.resolveChangeRequest({
    plan: "team",
    period: "monthly",
    seats: 5,
  });
  assert.equal(change.plan, "business");
  assert.deepEqual(change.requested, [
    { plan: "business", quantity: 1 },
    { plan: "business_extra", quantity: 2 },
  ]);
});

/* ---------- Stripe price verification ---------- */

function priceDb(plansByPeriod) {
  return {
    async query(_sql, values) {
      const key = `${values[0]}:${values[1]}`;
      const row = plansByPeriod[key];
      return { rows: row ? [row] : [] };
    },
  };
}

function priceLookup(amounts, { suffix = "_v4", interval = "month", override = {} } = {}) {
  return {
    prices: {
      async retrieve(id) {
        const plan = id.replace("price_", "");
        return {
          id,
          product: `zenvio_${plan}${suffix}`,
          active: true,
          currency: "usd",
          unit_amount: amounts[plan],
          recurring: { interval, interval_count: 1 },
          ...override,
        };
      },
    },
  };
}

test("the new recurring total comes from verified Stripe prices, including Team seats", async () => {
  const db = priceDb({
    "business:monthly": { stripe_price_id: "price_business", catalog_version: "2026-11-v4" },
    "business_extra:monthly": {
      stripe_price_id: "price_business_extra",
      catalog_version: "2026-11-v4",
    },
  });
  const verified = await preview.verifyChangePrices({
    db,
    stripe: priceLookup({ business: 3499, business_extra: 500 }),
    requested: [
      { plan: "business", quantity: 1 },
      { plan: "business_extra", quantity: 2 },
    ],
    period: "monthly",
    catalogVersion: "2026-11-v4",
    offers: [v4.planById("business"), v4.EXTRA_SEAT],
  });
  assert.equal(verified.recurringCents, 4499);
  assert.equal(verified.interval, "month");
  assert.deepEqual(verified.lines, [
    { price: "price_business", quantity: 1 },
    { price: "price_business_extra", quantity: 2 },
  ]);
});

test("a mismatched product, amount, interval, or catalog version cannot be quoted", async () => {
  const db = priceDb({
    "starter:annual": { stripe_price_id: "price_starter", catalog_version: "2026-11-v4" },
  });
  const base = {
    db,
    requested: [{ plan: "starter", quantity: 1 }],
    period: "annual",
    catalogVersion: "2026-11-v4",
    offers: [v4.planById("starter")],
  };
  await assert.rejects(
    preview.verifyChangePrices({
      ...base,
      stripe: priceLookup({ starter: 9588 }, { suffix: "_v3", interval: "year" }),
    }),
    /could not be verified/,
  );
  await assert.rejects(
    preview.verifyChangePrices({
      ...base,
      stripe: priceLookup({ starter: 9588 }, { interval: "month" }),
    }),
    /could not be verified/,
  );
  await assert.rejects(
    preview.verifyChangePrices({
      ...base,
      stripe: priceLookup({ starter: 999 }, { interval: "year" }),
    }),
    /could not be verified/,
  );
  await assert.rejects(
    preview.verifyChangePrices({
      ...base,
      catalogVersion: "2026-11-v3",
      stripe: priceLookup({ starter: 9588 }, { interval: "year" }),
    }),
    /temporarily unavailable/,
  );
});

/* ---------- Stripe invoice preview ---------- */

function subscription(overrides = {}) {
  return {
    id: "sub_1",
    customer: "cus_1",
    metadata: { user_id: "owner" },
    status: "active",
    items: {
      data: [
        {
          id: "si_1",
          quantity: 1,
          current_period_end: PERIOD_END,
          price: { id: "price_professional", unit_amount: 1999, recurring: { interval: "month" } },
        },
      ],
    },
    ...overrides,
  };
}

function previewStripe(lines, amountDue = 0, capture = {}) {
  return {
    invoices: {
      async createPreview(params) {
        capture.params = params;
        return { amount_due: amountDue, currency: "usd", lines: { data: lines } };
      },
    },
  };
}

test("an upgrade quotes the charge, the new recurring amount, and the next invoice", async () => {
  const capture = {};
  const result = await preview.previewChange({
    stripe: previewStripe(
      [
        { description: "Unused time on Professional", amount: -1200, proration: true },
        { description: "Remaining time on Team", amount: 1934, proration: true },
      ],
      734,
      capture,
    ),
    subscription: subscription(),
    items: [
      { price: "price_business", quantity: 1 },
      { price: "price_business_extra", quantity: 2 },
    ],
    recurringCents: 4499,
    currency: "usd",
    interval: "month",
    prorationDate: 1760000000,
  });
  assert.equal(result.amountDueCents, 734);
  assert.equal(result.creditCents, 0);
  assert.equal(result.prorationCents, 734);
  assert.equal(result.recurringCents, 4499);
  assert.equal(result.nextBillingAt, new Date(PERIOD_END * 1000).toISOString());
  assert.equal(result.prorationDate, 1760000000);
  assert.equal(result.lines.length, 2);
  // Stripe is the calculator: the preview pins the proration date and item set.
  assert.equal(capture.params.subscription_details.proration_behavior, "always_invoice");
  assert.equal(capture.params.subscription_details.proration_date, 1760000000);
  assert.deepEqual(capture.params.subscription_details.items, [
    { price: "price_business", quantity: 1 },
    { price: "price_business_extra", quantity: 2 },
  ]);
});

test("a downgrade reports the credit and bills nothing today", async () => {
  const result = await preview.previewChange({
    stripe: previewStripe(
      [
        { description: "Unused time on Team", amount: -2400, proration: true },
        { description: "Remaining time on Starter", amount: 700, proration: true },
      ],
      0,
    ),
    subscription: subscription(),
    items: [{ price: "price_starter", quantity: 1 }],
    recurringCents: 999,
    currency: "usd",
    interval: "month",
    prorationDate: 1760000000,
  });
  assert.equal(result.amountDueCents, 0);
  assert.equal(result.prorationCents, -1700);
  assert.equal(result.creditCents, 1700);
  assert.equal(result.recurringCents, 999);
});

test("an annual change keeps the yearly interval and period end", async () => {
  const result = await preview.previewChange({
    stripe: previewStripe([{ description: "Annual proration", amount: 19188, proration: true }], 19188),
    subscription: subscription({
      items: {
        data: [
          {
            quantity: 1,
            current_period_end: PERIOD_END,
            price: { id: "price_pro", unit_amount: 1999, recurring: { interval: "month" } },
          },
        ],
      },
    }),
    items: [{ price: "price_professional_annual", quantity: 1 }],
    recurringCents: 19188,
    currency: "usd",
    interval: "year",
    prorationDate: 1760000000,
  });
  assert.equal(result.interval, "year");
  assert.equal(result.amountDueCents, 19188);
  assert.equal(result.nextBillingAt, new Date(PERIOD_END * 1000).toISOString());
});

test("the billing period end falls back to the legacy subscription field", () => {
  assert.equal(preview.subscriptionPeriodEnd({ items: { data: [] }, current_period_end: 42 }), 42);
  assert.equal(
    preview.subscriptionPeriodEnd({ items: { data: [{ current_period_end: 7 }] }, current_period_end: 42 }),
    7,
  );
  assert.equal(preview.subscriptionPeriodEnd({}), null);
});

/* ---------- confirmation token ---------- */

function quote(overrides = {}) {
  const base = {
    subscriptionId: "sub_1",
    customerId: "cus_1",
    currency: "usd",
    interval: "month",
    prorationDate: 1760000000,
    amountDueCents: 734,
    creditCents: 0,
    prorationCents: 734,
    recurringCents: 4499,
    nextBillingAt: new Date(PERIOD_END * 1000).toISOString(),
    lines: [],
  };
  return { ...base, ...overrides };
}

test("a signed quote is accepted only for the exact reviewed amounts", async () => {
  const issuedAt = 1760000000000;
  const { token } = preview.signPreview(quote(), issuedAt);
  assert.match(token, /^1760000000000\.1760000000\.[a-f0-9]{64}$/);

  const seen = [];
  const confirmed = await preview.authorizePreview({
    token,
    now: issuedAt + 1000,
    compute: async (prorationDate) => {
      seen.push(prorationDate);
      return quote();
    },
  });
  assert.equal(confirmed.amountDueCents, 734);
  assert.deepEqual(seen, [1760000000]);

  await assert.rejects(
    preview.authorizePreview({
      token,
      now: issuedAt + 1000,
      compute: async () => quote({ amountDueCents: 999, prorationCents: 999 }),
    }),
    /changed after you reviewed/,
  );
  await assert.rejects(
    preview.authorizePreview({
      token,
      now: issuedAt + 1000,
      compute: async () => quote({ recurringCents: 3499 }),
    }),
    /changed after you reviewed/,
  );
  await assert.rejects(
    preview.authorizePreview({
      token,
      now: issuedAt + 1000,
      compute: async () => quote({ creditCents: 200, prorationCents: -200 }),
    }),
    /changed after you reviewed/,
  );
});

test("expired, malformed, and future quotes are refused", () => {
  const issuedAt = Date.now() - preview.PREVIEW_TTL_MS - 1000;
  const { token } = preview.signPreview(quote(), issuedAt);
  assert.throws(() => preview.readPreviewToken(token), /expired/);
  assert.throws(() => preview.readPreviewToken(""), /Review the exact prorated amounts/);
  assert.throws(() => preview.readPreviewToken("1.2"), /Review the exact prorated amounts/);
  assert.throws(() => preview.readPreviewToken(`1.2.${"z".repeat(64)}`), /Review the exact prorated amounts/);
  const future = preview.signPreview(quote(), Date.now() + 10 * 60 * 1000).token;
  assert.throws(() => preview.readPreviewToken(future), /not valid yet/);
});

test("the quote never trusts client-supplied amounts", () => {
  const { token } = preview.signPreview(quote());
  const [issuedAt, prorationDate] = token.split(".");
  assert.equal(Number(issuedAt) > 0, true);
  assert.equal(Number(prorationDate), 1760000000);
  // The token carries no money; the server recomputes from Stripe and compares.
  assert.equal(token.includes("734"), false);
});

/* ---------- preview route ---------- */

function v4Local(overrides = {}) {
  return {
    customer_id: "cus_1",
    subscription_id: "sub_1",
    plan: "professional",
    seats: 1,
    catalog_version: "2026-11-v4",
    ...overrides,
  };
}

function previewRouteFixture({ local = v4Local(), members = 0, invoice } = {}) {
  const capture = {};
  const db = {
    async query(sql, values) {
      if (sql.startsWith("SELECT customer_id,subscription_id")) return { rows: [local] };
      if (sql.startsWith("SELECT count(DISTINCT user_id)")) return { rows: [{ n: members }] };
      if (sql.startsWith("SELECT stripe_price_id")) {
        return {
          rows: [
            {
              stripe_price_id: `price_${values[0]}`,
              catalog_version: "2026-11-v4",
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const provider = {
    prices: {
      async retrieve(id) {
        const plan = id.replace("price_", "");
        const amounts = { business: 3499, business_extra: 500, professional: 1999, starter: 999 };
        return {
          id,
          product: `zenvio_${plan}_v4`,
          active: true,
          currency: "usd",
          unit_amount: amounts[plan],
          recurring: { interval: "month", interval_count: 1 },
        };
      },
    },
    subscriptions: { retrieve: async () => subscription() },
    invoices: {
      async createPreview(params) {
        capture.params = params;
        return (
          invoice || {
            amount_due: 734,
            currency: "usd",
            lines: {
              data: [
                { description: "Unused time on Professional", amount: -1200, proration: true },
                { description: "Remaining time on Team", amount: 1934, proration: true },
              ],
            },
          }
        );
      },
    },
  };
  const route = load("src/app/api/subscription-preview/route.ts", {
    "next/server": {},
    "@/lib/server": {
      ApiError,
      session: async () => ({ token: "owner", user: { name: "Owner", email: "owner@example.com" } }),
      sameOrigin() {},
      body: async () => input,
      failure: (e) => Response.json({ error: e.message }, { status: e.status || 400 }),
    },
    "@/lib/db": { getPool: () => db },
    "@/lib/billing": { stripeClient: async () => provider },
    "@/lib/pricing-activation": {
      billingEnvGates: () => ({ validated: true, addonValidated: false, checkoutEnabled: true }),
      billingSettings: async () => ({ enrollmentEnabled: true }),
    },
    "@/lib/pricing-catalog.mjs": v4,
    "@/lib/plan-display": plans,
    "@/lib/subscription-preview": preview,
  });
  let input = { plan: "business", seats: 5, period: "monthly" };
  return {
    capture,
    run: (values = {}) => {
      input = { ...input, ...values };
      return route.POST({});
    },
  };
}

test("the preview route returns the authoritative quote for a Team seat change", async () => {
  const fixture = previewRouteFixture();
  const response = await fixture.run();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.current.name, "Professional");
  assert.equal(body.current.seats, 1);
  assert.equal(body.current.amountCents, 1999);
  assert.equal(body.next.name, "Team");
  assert.equal(body.next.seats, 5);
  assert.equal(body.next.amountCents, 4499);
  assert.equal(body.immediate.amountDueCents, 734);
  assert.equal(body.immediate.creditCents, 0);
  assert.equal(body.recurring.amountCents, 4499);
  assert.equal(body.recurring.interval, "month");
  assert.equal(body.nextBillingAt, new Date(PERIOD_END * 1000).toISOString());
  assert.match(body.token, /^\d+\.\d+\.[a-f0-9]{64}$/);
  assert.deepEqual(fixture.capture.params.subscription_details.items, [
    { price: "price_business", quantity: 1 },
    { price: "price_business_extra", quantity: 2 },
  ]);
});

test("the preview route refuses a seat cut below active members and accounts without a subscription", async () => {
  const blocked = previewRouteFixture({ local: v4Local({ seats: 5 }), members: 5 });
  const blockedResponse = await blocked.run({ plan: "business", seats: 3 });
  assert.equal(blockedResponse.status, 409);
  assert.match((await blockedResponse.json()).error, /Remove or reassign staff/);

  const none = previewRouteFixture({ local: { ...v4Local(), subscription_id: null } });
  const noneResponse = await none.run();
  assert.equal(noneResponse.status, 404);
});

/* ---------- enrollment confirmation ---------- */

function enrollFixture({ local = v4Local(), members = 0 } = {}) {
  const capture = { update: null, audit: null, checkout: null };
  const v4Mappings = [
    { plan: "starter", period: "monthly" },
    { plan: "starter", period: "annual" },
    { plan: "professional", period: "monthly" },
    { plan: "professional", period: "annual" },
    { plan: "business", period: "monthly" },
    { plan: "business", period: "annual" },
    { plan: "business_extra", period: "monthly" },
    { plan: "business_extra", period: "annual" },
  ];
  let input = {
    plan: "business",
    seats: 5,
    period: "monthly",
    confirm: true,
  };
  const db = {
    release() {},
    async query(sql, values) {
      if (sql.startsWith("SELECT * FROM private.subscriptions")) return { rows: [local] };
      if (sql.startsWith("SELECT stripe_price_id")) {
        return {
          rows: [
            {
              stripe_price_id: `price_${values[0]}`,
              catalog_version: "2026-11-v4",
            },
          ],
        };
      }
      if (sql.startsWith("SELECT count(DISTINCT user_id)")) return { rows: [{ n: members }] };
      if (sql.startsWith("INSERT INTO private.operation_log")) {
        capture.audit = JSON.parse(values[2]);
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  const provider = {
    prices: {
      async retrieve(id) {
        const plan = id.replace("price_", "");
        const amounts = {
          business: 3499,
          business_extra: 500,
        };
        return {
          id,
          product: `zenvio_${plan}_v4`,
          active: true,
          currency: "usd",
          unit_amount: amounts[plan],
          recurring: { interval: "month", interval_count: 1 },
        };
      },
    },
    subscriptions: {
      retrieve: async () => subscription(),
      update: async (id, values) => {
        capture.update = { id, values };
        // Echo the requested items so saveSubscription (mocked) and the response
        // reflect the change the customer confirmed.
        return {
          id,
          status: "active",
          pending_update: null,
          items: { data: values.items.filter((item) => !item.deleted) },
        };
      },
    },
    invoices: {
      async createPreview() {
        return {
          amount_due: 734,
          currency: "usd",
          lines: { data: [{ description: "Proration", amount: 734, proration: true }] },
        };
      },
    },
    checkout: { sessions: { list: async () => ({ data: [] }), expire: async () => ({}) } },
  };
  const route = load("src/app/api/subscription-enroll/route.ts", {
    "next/server": {},
    "@/lib/server": {
      ApiError,
      session: async () => ({ token: "owner", user: { name: "Owner", email: "owner@example.com" } }),
      sameOrigin() {},
      body: async () => input,
      failure: (e) => Response.json({ error: e.message }, { status: e.status || 400 }),
    },
    "@/lib/db": { getPool: () => ({ connect: async () => db, query: async () => ({ rows: v4Mappings }) }) },
    "@/lib/billing": { stripeClient: async () => provider },
    "@/lib/subscription-management": { saveSubscription: async () => {} },
    "@/lib/billing-readiness": {
      billingReadiness: async () => ({ checkoutEnabled: true, connected: true, blockers: [] }),
    },
    "@/lib/pricing-catalog.mjs": v4,
    "@/lib/pricing-activation": {
      billingEnvGates: () => ({ validated: true, addonValidated: false, checkoutEnabled: true }),
      billingSettings: async () => ({ enrollmentEnabled: true }),
    },
    "@/lib/launch-controls": { launchControls: async () => ({ checkoutEnabled: true }) },
    "@/lib/lifecycle": { appOrigin: () => "https://gozenvio.test" },
    "@/lib/customer-messages": {
      customerMessages: {
        billing: {
          enrollPreparing: "Online enrollment isn’t open right now. No payment has been taken.",
          enrollPricingUnavailable: "This plan isn’t ready for enrollment yet. No payment has been taken.",
        },
      },
    },
    "@/lib/subscription-preview": preview,
  });
  return {
    capture,
    run: (values = {}) => {
      input = { ...input, ...values };
      return route.POST({});
    },
  };
}

function tokenFor(overrides = {}) {
  return preview.signPreview(quote(overrides)).token;
}

test("a v4 plan change without a reviewed quote is refused", async () => {
  const fixture = enrollFixture();
  const response = await fixture.run();
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /exact prorated amounts/);
  assert.equal(fixture.capture.update, null);
  assert.equal(fixture.capture.audit, null);
});

test("a v4 plan change submits the quoted proration date and audits the amounts", async () => {
  const fixture = enrollFixture();
  // The quote the enrollment route recomputes must match this preview exactly:
  // amount_due 734, proration 734, recurring 4499, period end 1900000000.
  const response = await fixture.run({ previewToken: tokenFor() });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal(fixture.capture.update.values.proration_date, 1760000000);
  assert.equal(fixture.capture.update.values.proration_behavior, "always_invoice");
  assert.equal(fixture.capture.update.values.payment_behavior, "pending_if_incomplete");
  assert.deepEqual(fixture.capture.audit, {
    plan: "business",
    period: "monthly",
    seats: 5,
    amount_due_cents: 734,
    proration_cents: 734,
    credit_cents: 0,
    recurring_cents: 4499,
    proration_date: 1760000000,
  });
});

test("a quote for different amounts cannot confirm this change", async () => {
  const fixture = enrollFixture();
  const response = await fixture.run({ previewToken: tokenFor({ amountDueCents: 100 }) });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /changed after you reviewed/);
  assert.equal(fixture.capture.update, null);
});

test("an expired quote cannot confirm a change", async () => {
  const fixture = enrollFixture();
  const expired = preview.signPreview(quote(), Date.now() - preview.PREVIEW_TTL_MS - 1000).token;
  const response = await fixture.run({ previewToken: expired });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /expired/);
  assert.equal(fixture.capture.update, null);
});

test("retired plan ids now require the same signed quote as every change", async () => {
  const fixture = enrollFixture();
  const response = await fixture.run({
    plan: "team",
    seats: 5,
    period: "monthly",
  });
  // One catalogue: a legacy id maps to Team and needs the quote like any change.
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /prorated|review/i);
});
