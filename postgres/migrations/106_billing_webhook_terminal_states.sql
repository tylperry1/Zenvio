-- Stripe checkout failures are terminal order states. Paid/refunded states remain unchanged.
--
-- Migration 062 created this column check inline, so PostgreSQL named it
-- `subscription_addon_orders_state_check`. This migration drops ONLY that exact
-- constraint. It never pattern-matches other constraints, so it cannot remove an
-- unrelated rule: if the canonical constraint is absent while some other check
-- mentions `state`, the migration stops with an explicit error instead of
-- guessing. A re-run after a successful apply is safe (drop + add the same name).
DO $$
DECLARE
  canonical boolean;
  candidates text;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'private.subscription_addon_orders'::regclass
       AND conname = 'subscription_addon_orders_state_check'
  ) INTO canonical;

  IF canonical THEN
    ALTER TABLE private.subscription_addon_orders
      DROP CONSTRAINT subscription_addon_orders_state_check;
  ELSE
    SELECT string_agg(conname, ', ' ORDER BY conname) INTO candidates
      FROM pg_constraint
     WHERE conrelid = 'private.subscription_addon_orders'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%state%';
    IF candidates IS NOT NULL THEN
      RAISE EXCEPTION
        'Migration 106 found unexpected state constraint(s) on private.subscription_addon_orders: %. Expected subscription_addon_orders_state_check. Review the schema before applying.',
        candidates;
    END IF;
  END IF;
END $$;

ALTER TABLE private.subscription_addon_orders
  ADD CONSTRAINT subscription_addon_orders_state_check
  CHECK (state IN ('pending','paid','refunded','partially_refunded','failed','expired'));
