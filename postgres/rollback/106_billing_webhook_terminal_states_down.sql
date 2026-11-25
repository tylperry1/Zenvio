-- Rollback for 106_billing_webhook_terminal_states.sql
--
-- WARNING: This migration is forward-incompatible once an order reaches the
-- new `failed` or `expired` state. PostgreSQL cannot validate the old
-- four-state CHECK while those rows exist, and silently rewriting them to
-- `pending` would make an expired order eligible for later fulfillment.
--
-- This script therefore fails closed when such rows exist. Resolve or archive
-- those orders according to BILLING_ROLLBACK_PROCEDURE.md before retrying.
-- It never drops the table, index, rows, or the extended constraint by default.
BEGIN;

DO $$
DECLARE
  blocked bigint;
BEGIN
  SELECT count(*) INTO blocked
    FROM private.subscription_addon_orders
   WHERE state IN ('failed', 'expired');

  IF blocked > 0 THEN
    RAISE EXCEPTION
      'Cannot roll back 106: % add-on order(s) use failed/expired. Archive or resolve them first; see BILLING_ROLLBACK_PROCEDURE.md.',
      blocked;
  END IF;
END $$;

ALTER TABLE private.subscription_addon_orders
  DROP CONSTRAINT IF EXISTS subscription_addon_orders_state_check;

ALTER TABLE private.subscription_addon_orders
  ADD CONSTRAINT subscription_addon_orders_state_check
  CHECK (state IN ('pending', 'paid', 'refunded', 'partially_refunded'));

-- Let scripts/migrate.mjs reapply 106 after this rollback. This only removes
-- the bookkeeping row; no order data is deleted.
DELETE FROM private.schema_migrations
 WHERE name = '106_billing_webhook_terminal_states.sql';

COMMIT;
