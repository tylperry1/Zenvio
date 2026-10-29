import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import ts from "typescript";
class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const helpers = {
  ApiError,
  string: (v, n, max, min = 1) => {
    if (typeof v !== "string" || v.trim().length < min || v.trim().length > max)
      throw new ApiError(n);
    return v.trim();
  },
  uuid: (v) => v,
  integer: (v, n, min, max) => {
    if (!Number.isInteger(v) || v < min || v > max) throw new ApiError(n);
    return v;
  },
};
function load(file, overrides = {}) {
  const filename = path.resolve(file),
    m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const require = m.require.bind(m);
  m.require = (id) =>
    Object.hasOwn(overrides, id)
      ? overrides[id]
      : id === "./resend-diagnostics"
        ? resendHelpers
        : require(id);
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
const resendHelpers = load("src/lib/resend-diagnostics.ts", {
  "./platform-settings": {},
  "./db": {},
});
const intake = load("src/lib/intake.ts", { "./server": helpers });
test("intake enforces required values and choice membership and snapshots original questions", () => {
  const questions = intake.intakeQuestions([
    { id: "goals", label: "Your goal", type: "short_text", required: true },
    {
      id: "services",
      label: "Services",
      type: "multiple_choice",
      required: true,
      options: ["A", "B"],
    },
  ]);
  assert.throws(() => intake.intakeAnswers(questions, {}));
  assert.throws(() =>
    intake.intakeAnswers(questions, { goals: "Test", services: ["forged"] }),
  );
  const snapshot = intake.intakeAnswers(questions, {
    goals: "Original goal",
    services: ["A"],
  });
  questions[0].label = "Changed label";
  assert.equal(snapshot[0].label, "Your goal");
  assert.equal(snapshot[0].answer, "Original goal");
  assert.throws(() =>
    intake.intakeQuestions([
      { id: "a", label: "Choice", type: "single_choice", options: ["x", "x"] },
    ]),
  );
});
const policy = load("src/lib/entitlement-policy.ts");
test("approved plan allocations are explicit and remain conservative for free accounts", () => {
  assert.deepEqual(policy.planLimits.free, {
    types: 1,
    calendars: 1,
    envelopes: 5,
    workflows: 0,
  });
  assert.equal(policy.planLimits.teams.envelopes, 100);
  assert.equal(policy.planLimits.business.workflows, 20);
});
const personal = load("src/lib/personalization.ts", { "./server": helpers });
test("personalization accepts server-owned option prices and rejects forged choices or foreign artwork", async () => {
  const product = {
    title: "Cards",
    personalization_options: [
      {
        key: "finish",
        label: "Finish",
        values: [
          {
            value: "Matte",
            price_delta_cents: 500,
            supplier_sku: "REAL-MATTE",
          },
        ],
      },
    ],
    artwork_allowed: true,
  };
  const db = { query: async () => ({ rows: [] }) };
  const r = await personal.resolvePersonalization(db, product, "owner", {
    options: { finish: "Matte" },
    price_delta_cents: -9999,
  });
  assert.equal(r.extra, 500);
  assert.equal(r.snapshot.choices[0].supplier_sku, "REAL-MATTE");
  await assert.rejects(
    personal.resolvePersonalization(db, product, "owner", {
      options: { finish: "Free" },
    }),
  );
  await assert.rejects(
    personal.resolvePersonalization(db, product, "owner", {
      options: { finish: "Matte" },
      artwork_id: "foreign",
    }),
    (e) => e.status === 404,
  );
});
test("capacity checks serialize allocation and never remove existing over-limit data", async () => {
  const queries = [];
  const db = {
    query: async (sql, args) => {
      queries.push(sql);
      if (sql.startsWith("SELECT s.plan"))
        return { rows: [{ plan: "free", status: "active", seats: 1 }] };
      if (sql.includes(") types"))
        return {
          rows: [{ types: 2, calendars: 1, envelopes: 7, workflows: 0 }],
        };
      return { rows: [] };
    },
  };
  const service = load("src/lib/entitlements.ts", {
    "./db": { getPool: () => db },
    "./server": helpers,
    "./entitlement-policy": policy,
  });
  await assert.rejects(
    service.requireCapacity(db, "owner", "types"),
    (e) => e.status === 409,
  );
  assert(queries.some((q) => q.includes("pg_advisory_xact_lock")));
  assert(!queries.some((q) => /DELETE|UPDATE/.test(q)));
});
test("stale reminder revisions cancel without sending or decrypting provider payloads", async () => {
  let sent = false,
    cancelled = false;
  const job = {
    id: "job",
    booking_id: "booking",
    booking_revision: 1,
    expires_at: new Date(Date.now() + 86400000),
    kind: "booking_reminder",
    dedupe_key: "reminder:booking:1:60",
    payload_ciphertext: "encrypted",
  };
  let selected = false;
  const db = {
    query: async (sql, args) => {
      if (sql.startsWith("SELECT * FROM private.delivery_jobs")) {
        if (selected) return { rows: [] };
        selected = true;
        return { rows: [job] };
      }
      if (sql.startsWith("SELECT b.status"))
        return {
          rows: [
            {
              status: "confirmed",
              revision: 2,
              starts_at: new Date(Date.now() + 86400000),
              reminder_minutes: [60],
            },
          ],
        };
      if (sql.includes("status='cancelled'")) cancelled = true;
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const service = load("src/lib/lifecycle.ts", {
    "./db": { getPool: () => ({ connect: async () => db }) },
    "./platform-settings": {
      integrationValue: async () => "configured",
      sealSecret: (x) => x,
      unsealSecret: () => {
        throw Error("Must not decrypt stale job");
      },
    },
    "./server": helpers,
  });
  const oldKey = process.env.INTEGRATION_ENCRYPTION_KEY,
    fetch = globalThis.fetch;
  process.env.INTEGRATION_ENCRYPTION_KEY = "test";
  globalThis.fetch = async () => {
    sent = true;
    throw Error("Must not send");
  };
  try {
    await service.drainDeliveries("owner", 1);
    assert(cancelled);
    assert.equal(sent, false);
  } finally {
    globalThis.fetch = fetch;
    if (oldKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
    else process.env.INTEGRATION_ENCRYPTION_KEY = oldKey;
  }
});
test("Connect checkout uses server prices, a connected account and no default commission", async () => {
  let created;
  const queries = [];
  const payment = {
    id: "payment",
    amount_cents: 2500,
    hold_expires_at: new Date(Date.now() + 31 * 60000),
  };
  const db = {
    query: async (sql, args) => {
      queries.push(sql);
      if (sql.startsWith("SELECT e.*"))
        return {
          rows: [
            {
              id: "type",
              owner_id: "owner",
              timezone: "UTC",
              payment_mode: "deposit",
              deposit_cents: 2500,
              price_cents: 10000,
              title: "Consultation",
              duration: 30,
              buffer: 15,
            },
          ],
        };
      if (sql.includes("public.public_slots")) return { rowCount: 1 };
      if (sql.startsWith("SELECT * FROM private.host_payment_accounts"))
        return { rows: [{ account_id: "acct_host" }] };
      if (sql.startsWith("INSERT INTO private.appointment_payments")) {
        assert.equal(args[3], 2500);
        assert.equal(args[4], 10000);
        return { rows: [payment] };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const stripe = {
    accounts: {
      retrieve: async (id) => {
        assert.equal(id, "acct_host");
        return { charges_enabled: true, payouts_enabled: true };
      },
    },
    checkout: {
      sessions: {
        create: async (input, options) => {
          created = { input, options };
          return { id: "cs_host", url: "https://checkout.stripe.test/fixture" };
        },
      },
    },
  };
  const service = load("src/lib/appointment-payments.ts", {
    "./db": { getPool: () => ({ ...db, connect: async () => db }) },
    "./billing": { stripeClient: async () => stripe },
    "./platform-settings": {
      integrationValue: async () => "configured",
      sealSecret: (x) => "encrypted",
      unsealSecret: () => {},
    },
    "./server": { ...helpers, email: (v) => v },
    "./google-calendar": { filterGoogleSlots: async (h, e, s) => s },
    "./lifecycle": {
      scheduleBooking: async () => {},
      appOrigin: () => "https://gozenvio.com",
    },
  });
  const old = process.env.APPOINTMENT_PAYMENTS_ENABLED;
  process.env.APPOINTMENT_PAYMENTS_ENABLED = "true";
  try {
    await service.createAppointmentCheckout(
      "host",
      "consultation",
      new Date(Date.now() + 86400000).toISOString(),
      { name: "Fixture", email: "fixture@example.com", price_cents: 1 },
    );
    assert.equal(created.input.line_items[0].price_data.unit_amount, 2500);
    assert.equal(created.options.stripeAccount, "acct_host");
    assert.equal(
      created.options.idempotencyKey,
      "appointment-checkout-payment",
    );
    assert(
      !Object.hasOwn(
        created.input.payment_intent_data,
        "application_fee_amount",
      ),
    );
    assert(queries.indexOf("COMMIT") < queries.length - 1);
  } finally {
    if (old === undefined) delete process.env.APPOINTMENT_PAYMENTS_ENABLED;
    else process.env.APPOINTMENT_PAYMENTS_ENABLED = old;
  }
});
test("paid webhook amount mismatch rolls back without creating an appointment", async () => {
  let inserted = false,
    rolledBack = false;
  const id = "11111111-1111-4111-8111-111111111111";
  const db = {
    query: async (sql) => {
      if (sql.startsWith("SELECT * FROM private.appointment_payments"))
        return {
          rows: [
            {
              id,
              account_id: "acct_host",
              checkout_id: "cs_bound",
              user_id: "host",
              amount_cents: 5000,
              currency: "usd",
            },
          ],
        };
      if (sql.startsWith("INSERT INTO public.bookings")) inserted = true;
      if (sql === "ROLLBACK") rolledBack = true;
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const service = load("src/lib/appointment-payments.ts", {
    "./db": { getPool: () => ({ connect: async () => db }) },
    "./billing": {
      stripeClient: async () => ({
        checkout: {
          sessions: {
            retrieve: async (cs, params, opts) => {
              assert.equal(opts.stripeAccount, "acct_host");
              return {
                metadata: { zenvio_appointment_payment: id },
                payment_status: "paid",
                amount_total: 1,
                currency: "usd",
              };
            },
          },
        },
      }),
    },
    "./platform-settings": {},
    "./server": helpers,
    "./google-calendar": {},
    "./lifecycle": {},
  });
  await assert.rejects(
    service.reconcileAppointmentPayment(
      "acct_host",
      "cs_bound",
      "evt_mismatch",
    ),
    /amount mismatch/,
  );
  assert(rolledBack);
  assert(!inserted);
});
test("duplicate paid webhook is acknowledged without booking or decrypting again", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  let commits = 0;
  const db = {
    query: async (sql) => {
      if (sql.startsWith("SELECT * FROM private.appointment_payments"))
        return { rows: [{ id, checkout_id: "cs_bound", user_id: "host" }] };
      if (sql.startsWith("SELECT 1 FROM private.appointment_payment_events"))
        return { rowCount: 1 };
      if (sql.startsWith("INSERT")) throw Error("Duplicate must not write");
      if (sql === "COMMIT") commits++;
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const service = load("src/lib/appointment-payments.ts", {
    "./db": { getPool: () => ({ connect: async () => db }) },
    "./billing": {
      stripeClient: async () => ({
        checkout: {
          sessions: {
            retrieve: async () => ({
              metadata: { zenvio_appointment_payment: id },
              payment_status: "paid",
            }),
          },
        },
      }),
    },
    "./platform-settings": {
      unsealSecret: () => {
        throw Error("Must not decrypt");
      },
    },
    "./server": helpers,
    "./google-calendar": {},
    "./lifecycle": {},
  });
  await service.reconcileAppointmentPayment(
    "acct_host",
    "cs_bound",
    "evt_duplicate",
  );
  assert.equal(commits, 1);
});

test("delivery first-attempt timestamp survives an acceptance followed by transaction rollback", async () => {
  const queries = [];
  let key;
  const job = {
    id: "durable-job",
    expires_at: new Date(Date.now() + 86400000),
    kind: "document_complete",
    payload_ciphertext: "encrypted",
    recipient: "fixture@example.com",
    subject: "Fixture",
  };
  const db = {
    query: async (sql) => {
      queries.push(sql);
      if (sql.startsWith("SELECT * FROM private.delivery_jobs"))
        return { rows: [job], rowCount: 1 };
      if (
        sql.startsWith("UPDATE private.delivery_jobs SET claimed_at=coalesce")
      )
        return { rows: [{ claimed_at: new Date() }], rowCount: 1 };
      if (sql === "COMMIT") throw Error("Simulated ambiguous commit");
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const service = load("src/lib/lifecycle.ts", {
    "./db": { getPool: () => ({ connect: async () => db }) },
    "./platform-settings": {
      integrationValue: async () => "fixture",
      unsealSecret: () => "Fixture message",
    },
    "./server": helpers,
  });
  const old = process.env.INTEGRATION_ENCRYPTION_KEY,
    fetch = globalThis.fetch;
  process.env.INTEGRATION_ENCRYPTION_KEY = "fixture";
  globalThis.fetch = async (url, options) => {
    key = options.headers["Idempotency-Key"];
    return { ok: true, json: async () => ({ id: "provider-fixture" }) };
  };
  try {
    await assert.rejects(
      service.drainDeliveries("owner", 1),
      /ambiguous commit/,
    );
    assert.equal(key, "zenvio-delivery-durable-job");
    assert(
      queries.findIndex((q) =>
        q.startsWith("UPDATE private.delivery_jobs SET claimed_at"),
      ) < queries.indexOf("BEGIN"),
    );
    assert(queries.includes("ROLLBACK"));
  } finally {
    globalThis.fetch = fetch;
    if (old === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
    else process.env.INTEGRATION_ENCRYPTION_KEY = old;
  }
});
test("shared team workflow capacity blocks a staff allocation under its individual allowance", async () => {
  const locks = [];
  const db = {
    query: async (sql, args) => {
      if (sql.includes("private.team_entitlement_roots"))
        return { rows: [{ owner_id: "billing-owner", seats: 3 }] };
      if (sql.startsWith("SELECT s.plan"))
        return { rows: [{ effective_plan: "teams", seats: 3 }] };
      if (sql.startsWith("WITH hosts"))
        return { rows: [{ envelopes: 3, workflows: 25 }] };
      if (sql.includes(") types"))
        return {
          rows: [{ types: 1, calendars: 0, envelopes: 1, workflows: 2 }],
        };
      if (sql.includes("pg_advisory_xact_lock")) locks.push(args[0]);
      return { rows: [], rowCount: 1 };
    },
  };
  const service = load("src/lib/entitlements.ts", {
    "./db": { getPool: () => db },
    "./server": helpers,
    "./entitlement-policy": policy,
  });
  await assert.rejects(
    service.requireCapacity(db, "staff", "workflows"),
    (e) => e.status === 409 && e.message.includes("shared"),
  );
  assert.deepEqual(locks, ["entitlements:billing-owner", "entitlements:staff"]);
});
