# Zenvio 2.0 — Billing Rollback Procedure

Date: 2026-11-24  
Applies to migrations:

- `postgres/migrations/106_billing_webhook_terminal_states.sql`
- `postgres/migrations/107_entitlement_override_catalog_version.sql`

Read [BILLING_RELEASE_CODE_REVIEW.md](BILLING_RELEASE_CODE_REVIEW.md) before executing any step. This procedure is written for an owner-authorized operator with production database and deployment access. It was tested only against a disposable PostgreSQL 18 database, never production.

## 1. Decision: code rollback first

Both migrations are additive.

- `106` only replaces the add-on order state check with a superset of allowed states.
- `107` only adds a nullable `catalog_version` column to entitlement grants.

The previous application ignores both changes. Therefore the **preferred rollback for an application regression is to redeploy the previous build and leave the schema in place**. Do not run schema rollback merely because the application build is being reverted.

Run the guarded schema rollback only when the owner explicitly requires the database schema to return to its pre-106/107 shape, and only after the data-preservation steps below.

## 2. Forward ordering and dependencies

Apply in this order:

1. `106_billing_webhook_terminal_states.sql`
2. `107_entitlement_override_catalog_version.sql`

Dependencies:

- `106` depends on `private.subscription_addon_orders` and its original `subscription_addon_orders_state_check` from migration `062_pricing_economics.sql` (created inline, so PostgreSQL gave it that canonical name). `106` drops only that name; if it is missing while another check constraint mentions `state`, the migration stops with `Migration 106 found unexpected state constraint(s) …` and changes nothing. The down script uses the same canonical name and never touches a differently named constraint.
- `107` depends on `private.entitlement_overrides` from migration `019_workspaces_entitlements.sql` and its expanded plan check from migration `092_billing_coupons_entitlements.sql`.
- Neither migration depends on the other, but the migration runner applies filenames alphabetically: `106` before `107`.
- `scripts/migrate.mjs` records each applied file in `private.schema_migrations` with a SHA-256 checksum and runs each file in its own transaction.

Reverse ordering for a full schema rollback:

1. `107_entitlement_override_catalog_version_down.sql`
2. `106_billing_webhook_terminal_states_down.sql`

## 3. Preflight snapshot (read-only)

Run these before any rollback. Save the output outside the database and outside chat.

```sql
-- Applied migration state and checksums
SELECT name, checksum, applied_at
  FROM private.schema_migrations
 WHERE name IN (
   '106_billing_webhook_terminal_states.sql',
   '107_entitlement_override_catalog_version.sql'
 )
 ORDER BY name;

-- The add-on state constraint and every competing candidate
SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conrelid = 'private.subscription_addon_orders'::regclass
   AND contype = 'c'
   AND pg_get_constraintdef(oid) ILIKE '%state%'
 ORDER BY conname;

-- Terminal orders that block the 106 down script
SELECT state, count(*)::int AS orders
  FROM private.subscription_addon_orders
 WHERE state IN ('failed', 'expired')
 GROUP BY state
 ORDER BY state;

-- Grants that block the 107 down script
SELECT plan, catalog_version, count(*)::int AS grants
  FROM private.entitlement_overrides
 WHERE catalog_version IS NOT NULL
 GROUP BY plan, catalog_version
 ORDER BY plan, catalog_version;

-- Subscription baseline; preserve for before/after comparison
SELECT plan, status, seats, catalog_version, count(*)::int AS subscriptions
  FROM private.subscriptions
 GROUP BY plan, status, seats, catalog_version
 ORDER BY plan, status, seats, catalog_version;
```

Required preflight results:

- `106` was applied and its checksum is unchanged.
- A constraint named `subscription_addon_orders_state_check` exists and its definition is the six-state check:
  `CHECK (state = ANY (ARRAY['pending','paid','refunded','partially_refunded','failed','expired']))`
- Any **other** check constraint whose definition mentions `state` is a schema-drift signal. The migration fails closed on it and the down script would only drop the canonical name, so the unrelated rule survives; review the schema before applying or rolling back. See CR-08 in the code review.
- `107` was applied and the column is nullable `text`.

The same checks can be reproduced offline before touching production:

```bash
npm install --no-save @electric-sql/pglite
node scripts/verify-migration-106.mjs
```

## 4. Production backup

Take a provider snapshot or a custom-format `pg_dump` before any schema change. The backup must include the `private` schema and the `public."user"` table referenced by foreign keys.

Example, with credentials supplied by the database owner and never pasted into chat:

```bash
pg_dump "$DATABASE_URL_UNPOOLED" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file=zenvio-pre-billing-rollback.dump
```

Verify the dump is readable and non-empty before proceeding. Record the restore command and the person responsible for it.

## 5. Data-preservation strategy for 106

**Never rewrite `failed` or `expired` orders back to `pending`.** That would make an expired order eligible for later fulfillment and could grant credits for a payment that did not complete.

The 106 down script has a fail-closed guard:

```sql
SELECT count(*) INTO blocked
  FROM private.subscription_addon_orders
 WHERE state IN ('failed', 'expired');

IF blocked > 0 THEN
  RAISE EXCEPTION 'Cannot roll back 106...';
END IF;
```

If the guard fires, choose one:

### Option A — Preferred: leave 106 applied

Redeploy the previous application and leave the six-state constraint. The old code does not need the four-state constraint to function and will not grant on terminal rows.

### Option B — Full schema rollback with archive

Archive terminal rows in a separate table, verify the archive, then delete only those rows from the live table.

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS private.subscription_addon_orders_terminal_archive
  AS
SELECT *
  FROM private.subscription_addon_orders
 WHERE state IN ('failed', 'expired');

-- Verify the archive count matches the live terminal count before deleting.
SELECT count(*) FROM private.subscription_addon_orders_terminal_archive;

DELETE FROM private.subscription_addon_orders
 WHERE state IN ('failed', 'expired');

COMMIT;
```

Then run `postgres/rollback/106_billing_webhook_terminal_states_down.sql`. Keep the archive table and a dump until the rollback is accepted. If the application is later restored and terminal orders must return, restore them from the archive only after re-applying `106`; do not restore them under the four-state constraint.

The down script preserves all `pending`, `paid`, `refunded`, and `partially_refunded` rows.

## 6. Data-preservation strategy for 107

`catalog_version` is the only record that distinguishes a v4 Team grant (`plan = business`, catalog `2026-11-v4`) from legacy Business. Dropping it while populated destroys grant identity.

The 107 down script has a fail-closed guard:

```sql
SELECT count(*) INTO populated
  FROM private.entitlement_overrides
 WHERE catalog_version IS NOT NULL;

IF populated > 0 THEN
  RAISE EXCEPTION 'Cannot roll back 107...';
END IF;
```

If the guard fires, choose one:

### Option A — Preferred: leave 107 applied

Redeploy the previous application and leave the nullable column. It is ignored by the previous code and does not change any plan. This is the recommended code rollback.

### Option B — Full schema rollback with archive

Archive the grants, including `user_id`, `plan`, `expires_at`, `actor_id`, `reason`, and `catalog_version`, then remove the populated rows only after verifying the archive.

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS private.entitlement_overrides_catalog_archive
  AS
SELECT *
  FROM private.entitlement_overrides
 WHERE catalog_version IS NOT NULL;

SELECT count(*) FROM private.entitlement_overrides_catalog_archive;

DELETE FROM private.entitlement_overrides
 WHERE catalog_version IS NOT NULL;

COMMIT;
```

Then run `postgres/rollback/107_entitlement_override_catalog_version_down.sql`. To restore after re-applying `107`, insert the archived rows back with their original `catalog_version`; verify `user_id` uniqueness before insertion.

**Do not** restore archived v4 grants without their catalog version. A v4 `business` grant would resolve as legacy Business and lose three-seat/v4 limits.

## 7. Executing the rollback

Run each file as a single transaction. The files contain `BEGIN` and `COMMIT`.

```bash
psql "$DATABASE_URL_UNPOOLED" \
  --set ON_ERROR_STOP=1 \
  --file postgres/rollback/107_entitlement_override_catalog_version_down.sql

psql "$DATABASE_URL_UNPOOLED" \
  --set ON_ERROR_STOP=1 \
  --file postgres/rollback/106_billing_webhook_terminal_states_down.sql
```

On any error, PostgreSQL rolls back that file. Do not continue to the next file until the cause is understood. The guards are intentionally fail-closed.

The down scripts also delete the corresponding `private.schema_migrations` rows so `scripts/migrate.mjs` can reapply the migrations later. They do not delete order or entitlement business data.

## 8. Verification after rollback

```sql
-- 106: four-state constraint restored
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conname = 'subscription_addon_orders_state_check';

-- Terminal rows should be zero if a full rollback was performed.
SELECT state, count(*)::int
  FROM private.subscription_addon_orders
 GROUP BY state
 ORDER BY state;

-- 107: column absent
SELECT count(*)::int AS column_present
  FROM information_schema.columns
 WHERE table_schema = 'private'
   AND table_name = 'entitlement_overrides'
   AND column_name = 'catalog_version';

-- Bookkeeping rows absent
SELECT name
  FROM private.schema_migrations
 WHERE name IN (
   '106_billing_webhook_terminal_states.sql',
   '107_entitlement_override_catalog_version.sql'
 );
```

Expected: the four-state check is present; no `failed`/`expired` orders remain if the archive/delete path was used; the column is absent; both bookkeeping rows are absent.

Confirm the subscription baseline matches the preflight output. No subscription row should change because of either rollback.

## 9. Reapplying

Run the normal migration path:

```bash
DATABASE_URL_UNPOOLED="$DATABASE_URL_UNPOOLED" node scripts/migrate.mjs
```

Expected output includes:

```text
Applied 106_billing_webhook_terminal_states.sql
Applied 107_entitlement_override_catalog_version.sql
```

Then verify:

- six-state constraint present;
- `catalog_version` column present and nullable;
- both checksum rows present;
- paid/refunded order rows and non-terminal grants still present;
- archived terminal orders/grants are not silently reinserted unless intentionally restored.

Reapplication does not restore archived rows automatically.

## 10. Tested evidence

### 10a. Repeatable harness (current migration and rollback files)

`scripts/verify-migration-106.mjs` runs the repository's exact `106`, `107` and both down scripts against a real PostgreSQL engine (PGlite) on a schema mirroring migration `062`. Result: **8/8 scenarios pass**.

1. The legacy schema exposes exactly one state check, named `subscription_addon_orders_state_check`.
2. Upgrade: `106` + `107` apply, `paid`/`pending` rows survive, `failed` is accepted, an unknown state is rejected, the nullable column appears, and re-running `106` is idempotent.
3. Drift with an unrelated `addon_state_drift_guard`: only the canonical constraint is dropped; the unrelated rule remains.
4. Drift with only the unrelated check: `106` raises `unexpected state constraint` and adds nothing.
5. Rollback `106` refuses while a `failed`/`expired` row exists and leaves the six-state constraint intact.
6. Rollback `106` restores the four-state check, preserves the paid order, removes its bookkeeping row, rejects a new `failed` row, and reapply restores six states.
7. Rollback `107` refuses while a grant carries a catalog version and does not drop the column.
8. Rollback `107` drops the column, preserves order rows, removes its bookkeeping row, and reapply restores the column.

This harness is the pre-deployment gate; it never connects to a configured database.

### 10b. Earlier disposable-database run (previous dynamic-discovery version)

The procedure was exercised against a disposable PostgreSQL 18 database:

1. All 109 migrations applied.
2. Seeded one `failed` and one `expired` order, plus one v4 grant with `catalog_version`.
3. `107` down refused with the guard.
4. `106` down refused with the guard.
5. Removed the terminal test rows, inserted a `paid` order, and ran `106` down successfully.
6. Confirmed the four-state constraint returned, the `paid` order remained, and a new `failed` row was rejected with SQLSTATE `23514`.
7. Removed the v4 test grant and ran `107` down successfully; confirmed the column was gone and the paid order remained.
8. Confirmed both `schema_migrations` rows were removed.
9. Ran `scripts/migrate.mjs`; it reapplied `106` then `107`.
10. Confirmed the six-state constraint and column returned and the paid order remained.

That run proves the guards and ordering of the previous dynamic-discovery version. The current migration and rollback files are covered by the repeatable harness above. Neither proves production data compatibility: production preflight and backup remain mandatory.

## 11. Irreversible or high-risk operations

- Dropping the populated `catalog_version` column loses v4 grant identity unless archived.
- Deleting `failed`/`expired` orders loses terminal payment audit rows unless archived.
- Rewriting terminal states to `pending` is prohibited.
- Dropping the six-state constraint while terminal rows exist is impossible without changing those rows.
- Restoring a pre-migration database snapshot discards all activity after the snapshot; use it only as a last resort with owner approval.
- The down scripts remove migration bookkeeping rows. Do not run them while another deployment's migration process is active.

## 12. Emergency decision table

| Situation | Action |
|---|---|
| Application regression, database healthy | Redeploy previous build; leave `106`/`107` applied. |
| Migration 106 failed before commit | No schema change. `unexpected state constraint(s)` means the canonical name is missing; review the schema, never rename or add a constraint to force it through. |
| Migration 106 committed, 107 failed | Build should have stopped. Leave 106 applied; retry 107 after preflight. |
| Full schema rollback requested, no terminal/v4 data | Run 107 down, then 106 down; verify; reapply when ready. |
| Terminal orders or v4 grants exist | Do **not** force rollback. Leave schema, or archive and document recovery. |
| Production data corrupted | Stop writes, restore the verified backup, then reapply migrations in order. |
