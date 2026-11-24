/**
 * Verification harness for migrations 106/107 and their guarded rollbacks.
 *
 * Runs against a real PostgreSQL engine (PGlite) using the exact migration and
 * rollback SQL from this repository, on a schema that mirrors migration 062.
 * It never touches a configured database.
 *
 *   npm install --no-save @electric-sql/pglite
 *   node scripts/verify-migration-106.mjs
 *
 * Or point PGLITE_PATH at an existing install of the package.
 */
import fs from "node:fs";
import path from "node:path";

const PGLITE_PATH = process.env.PGLITE_PATH || "@electric-sql/pglite";
const { PGlite } = await import(PGLITE_PATH);

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration106 = read("postgres/migrations/106_billing_webhook_terminal_states.sql");
const migration107 = read("postgres/migrations/107_entitlement_override_catalog_version.sql");
const rollback106 = read("postgres/rollback/106_billing_webhook_terminal_states_down.sql");
const rollback107 = read("postgres/rollback/107_entitlement_override_catalog_version_down.sql");

function baseSchema({ driftConstraint = false } = {}) {
  return `
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE private.subscription_addon_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_owner uuid NOT NULL,
  addon text NOT NULL,
  meter text NOT NULL,
  quantity bigint NOT NULL CHECK (quantity > 0),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  customer_id text NOT NULL,
  checkout_id text UNIQUE,
  payment_intent_id text UNIQUE,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','paid','refunded','partially_refunded')),
  refunded_cents integer NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0 AND refunded_cents <= amount_cents),
  reversed_credits bigint NOT NULL DEFAULT 0 CHECK (reversed_credits >= 0 AND reversed_credits <= quantity),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE TABLE private.entitlement_overrides (
  user_id uuid PRIMARY KEY,
  plan text NOT NULL,
  expires_at timestamptz NOT NULL,
  actor_id uuid,
  reason text
);
CREATE TABLE private.schema_migrations (
  name text PRIMARY KEY,
  checksum text,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO private.schema_migrations(name, checksum) VALUES
  ('106_billing_webhook_terminal_states.sql', 'checksum-106'),
  ('107_entitlement_override_catalog_version.sql', 'checksum-107');
INSERT INTO private.subscription_addon_orders(billing_owner, addon, meter, quantity, amount_cents, customer_id, checkout_id, state)
VALUES ('00000000-0000-0000-0000-000000000001','ai_100','aiCredits',100,299,'cus_1','cs_paid','paid'),
       ('00000000-0000-0000-0000-000000000002','ai_500','aiCredits',500,999,'cus_1','cs_pending','pending');
${driftConstraint ? "ALTER TABLE private.subscription_addon_orders ADD CONSTRAINT addon_state_drift_guard CHECK (state <> 'archived');" : ""}
`;
}

const rows = async (db, sql, params) => (await db.query(sql, params)).rows;
const constraintDef = async (db, name) =>
  (
    await rows(
      db,
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='private.subscription_addon_orders'::regclass AND conname=$1",
      [name],
    )
  )[0]?.def;
const constraintNames = async (db) =>
  (
    await rows(
      db,
      "SELECT conname FROM pg_constraint WHERE conrelid='private.subscription_addon_orders'::regclass AND contype='c' ORDER BY conname",
    )
  ).map((row) => row.conname);
const orderStates = async (db) =>
  (
    await rows(
      db,
      "SELECT checkout_id, state FROM private.subscription_addon_orders ORDER BY checkout_id",
    )
  ).map((row) => `${row.checkout_id}:${row.state}`);
const bookkeeping = async (db, name) =>
  (
    await rows(db, "SELECT 1 FROM private.schema_migrations WHERE name=$1", [name])
  ).length;
const rejects = async (promise, pattern) => {
  try {
    await promise;
  } catch (error) {
    if (!pattern.test(String(error.message)))
      throw new Error(`expected ${pattern} but got: ${error.message}`);
    return;
  }
  throw new Error(`expected ${pattern}, but the statement succeeded`);
};
/** The rollback scripts open an explicit transaction; a guarded failure leaves it open. */
const resetTransaction = async (db) => {
  try {
    await db.exec("ROLLBACK");
  } catch {
    /* no open transaction */
  }
};
function ok(condition, message) {
  if (!condition) throw new Error(message);
}

const results = [];
async function scenario(name, fn) {
  const db = new PGlite();
  try {
    await fn(db);
    results.push({ name, result: "PASS", detail: "" });
  } catch (error) {
    results.push({ name, result: "FAIL", detail: error.message });
  } finally {
    await db.close();
  }
}

await scenario("legacy schema exposes exactly one canonical state constraint", async (db) => {
  await db.exec(baseSchema());
  const names = await constraintNames(db);
  ok(names.length >= 4, `expected the table's check constraints, saw ${names.join(", ")}`);
  ok(
    names.includes("subscription_addon_orders_state_check"),
    `canonical constraint missing: ${names.join(", ")}`,
  );
  const stateConstraints = [];
  for (const name of names) {
    const definition = await constraintDef(db, name);
    if (/%state%/.test(definition) || definition.includes("state")) stateConstraints.push(name);
  }
  ok(
    stateConstraints.length === 1 &&
      stateConstraints[0] === "subscription_addon_orders_state_check",
    `state mentions resolved to ${stateConstraints.join(", ")}`,
  );
});

await scenario("upgrade path: 106 and 107 apply and preserve order rows", async (db) => {
  await db.exec(baseSchema());
  const before = await orderStates(db);
  await db.exec(migration106);
  let definition = await constraintDef(db, "subscription_addon_orders_state_check");
  ok(definition.includes("'failed'") && definition.includes("'expired'"), definition);
  await db.exec(
    "INSERT INTO private.subscription_addon_orders(billing_owner,addon,meter,quantity,amount_cents,customer_id,checkout_id,state) VALUES (gen_random_uuid(),'ai_100','aiCredits',100,299,'cus_1','cs_failed','failed')",
  );
  await rejects(
    db.exec(
      "INSERT INTO private.subscription_addon_orders(billing_owner,addon,meter,quantity,amount_cents,customer_id,checkout_id,state) VALUES (gen_random_uuid(),'ai_100','aiCredits',100,299,'cus_1','cs_bogus','archived')",
    ),
    /violates check constraint/,
  );
  await db.exec(migration107);
  const column = await rows(
    db,
    "SELECT is_nullable FROM information_schema.columns WHERE table_schema='private' AND table_name='entitlement_overrides' AND column_name='catalog_version'",
  );
  ok(column[0]?.is_nullable === "YES", "catalog_version column missing or not nullable");
  const after = await orderStates(db);
  for (const entry of before)
    ok(after.includes(entry), `order row ${entry} changed: ${after.join(", ")}`);
  // Re-applying 106 is idempotent (drop + add the canonical name).
  await db.exec(migration106);
  definition = await constraintDef(db, "subscription_addon_orders_state_check");
  ok(definition.includes("'expired'"), "reapply lost the six-state constraint");
});

await scenario(
  "drift: 106 drops only the canonical constraint and keeps an unrelated check",
  async (db) => {
    await db.exec(baseSchema({ driftConstraint: true }));
    await db.exec(migration106);
    const names = await constraintNames(db);
    ok(names.includes("addon_state_drift_guard"), "unrelated constraint was removed");
    ok(names.includes("subscription_addon_orders_state_check"), "canonical constraint missing");
    const drift = await constraintDef(db, "addon_state_drift_guard");
    ok(drift.includes("archived"), `unrelated constraint changed: ${drift}`);
  },
);

await scenario(
  "drift: 106 fails closed when only an unrelated state constraint exists",
  async (db) => {
    await db.exec(baseSchema({ driftConstraint: true }));
    await db.exec(
      "ALTER TABLE private.subscription_addon_orders DROP CONSTRAINT subscription_addon_orders_state_check",
    );
    await rejects(db.exec(migration106), /unexpected state constraint/);
    const names = await constraintNames(db);
    ok(names.includes("addon_state_drift_guard"), "unrelated constraint was dropped on failure");
    ok(
      !names.includes("subscription_addon_orders_state_check"),
      "migration added a constraint despite failing",
    );
  },
);

await scenario("rollback 106 refuses while failed/expired rows exist", async (db) => {
  await db.exec(baseSchema());
  await db.exec(migration106);
  await db.exec(
    "INSERT INTO private.subscription_addon_orders(billing_owner,addon,meter,quantity,amount_cents,customer_id,checkout_id,state) VALUES (gen_random_uuid(),'ai_100','aiCredits',100,299,'cus_1','cs_expired','expired')",
  );
  await rejects(db.exec(rollback106), /Cannot roll back 106/);
  await resetTransaction(db);
  const definition = await constraintDef(db, "subscription_addon_orders_state_check");
  ok(definition.includes("'expired'"), "rollback changed the constraint despite failing");
  ok((await bookkeeping(db, "106_billing_webhook_terminal_states.sql")) === 1, "bookkeeping row lost");
});

await scenario("rollback 106 restores the four-state check and reapply works", async (db) => {
  await db.exec(baseSchema());
  await db.exec(migration106);
  await db.exec("DELETE FROM private.subscription_addon_orders WHERE checkout_id='cs_pending'");
  const paidBefore = await rows(
    db,
    "SELECT amount_cents, state FROM private.subscription_addon_orders WHERE checkout_id='cs_paid'",
  );
  await db.exec(rollback106);
  let definition = await constraintDef(db, "subscription_addon_orders_state_check");
  ok(!definition.includes("'failed'") && !definition.includes("'expired'"), definition);
  await rejects(
    db.exec(
      "INSERT INTO private.subscription_addon_orders(billing_owner,addon,meter,quantity,amount_cents,customer_id,checkout_id,state) VALUES (gen_random_uuid(),'ai_100','aiCredits',100,299,'cus_1','cs_new_failed','failed')",
    ),
    /violates check constraint/,
  );
  const paidAfter = await rows(
    db,
    "SELECT amount_cents, state FROM private.subscription_addon_orders WHERE checkout_id='cs_paid'",
  );
  ok(JSON.stringify(paidBefore) === JSON.stringify(paidAfter), "paid order changed during rollback");
  ok(
    (await bookkeeping(db, "106_billing_webhook_terminal_states.sql")) === 0,
    "bookkeeping row survived rollback",
  );
  await db.exec(migration106);
  definition = await constraintDef(db, "subscription_addon_orders_state_check");
  ok(definition.includes("'failed'") && definition.includes("'expired'"), "reapply failed");
});

await scenario("rollback 107 refuses while grants carry a catalog version", async (db) => {
  await db.exec(baseSchema());
  await db.exec(migration107);
  await db.exec(
    "INSERT INTO private.entitlement_overrides(user_id,plan,expires_at,catalog_version) VALUES (gen_random_uuid(),'business',now()+interval '30 days','2026-11-v4')",
  );
  await rejects(db.exec(rollback107), /Cannot roll back 107/);
  await resetTransaction(db);
  const column = await rows(
    db,
    "SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='entitlement_overrides' AND column_name='catalog_version'",
  );
  ok(column.length === 1, "rollback dropped the column despite failing");
});

await scenario("rollback 107 drops the column and 107 reapplies without touching orders", async (db) => {
  await db.exec(baseSchema());
  await db.exec(migration106);
  await db.exec(migration107);
  const before = await orderStates(db);
  await db.exec(rollback107);
  const column = await rows(
    db,
    "SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='entitlement_overrides' AND column_name='catalog_version'",
  );
  ok(column.length === 0, "column still present after rollback");
  ok(
    (await bookkeeping(db, "107_entitlement_override_catalog_version.sql")) === 0,
    "bookkeeping row survived rollback",
  );
  ok(JSON.stringify(before) === JSON.stringify(await orderStates(db)), "order rows changed");
  await db.exec(migration107);
  const restored = await rows(
    db,
    "SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='entitlement_overrides' AND column_name='catalog_version'",
  );
  ok(restored.length === 1, "reapply failed");
});

const failed = results.filter((result) => result.result === "FAIL");
console.log("\nMigration 106/107 verification (PGlite, PostgreSQL-compatible)\n");
for (const result of results)
  console.log(`${result.result.padEnd(4)} ${result.name}${result.detail ? `\n     ${result.detail}` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`);
process.exit(failed.length ? 1 : 0);
