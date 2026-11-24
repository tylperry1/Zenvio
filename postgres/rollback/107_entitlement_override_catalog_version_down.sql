-- Rollback for 107_entitlement_override_catalog_version.sql
--
-- WARNING: Dropping `catalog_version` destroys the only record that
-- distinguishes a v4 Starter/Professional/Team grant from a legacy plan id.
-- A v4 `business` grant would then resolve as legacy Business (single seat)
-- and its recorded catalog would be lost.
--
-- This script fails closed when any override carries a catalog version.
-- For a code-only rollback, leave this additive nullable column in place; it
-- is ignored by the previous application and does not alter existing plans.
BEGIN;

DO $$
DECLARE
  populated bigint;
BEGIN
  SELECT count(*) INTO populated
    FROM private.entitlement_overrides
   WHERE catalog_version IS NOT NULL;

  IF populated > 0 THEN
    RAISE EXCEPTION
      'Cannot roll back 107: % entitlement override(s) carry catalog_version. Preserve the column or archive and restore those values; see BILLING_ROLLBACK_PROCEDURE.md.',
      populated;
  END IF;
END $$;

ALTER TABLE private.entitlement_overrides
  DROP COLUMN IF EXISTS catalog_version;

-- Let scripts/migrate.mjs reapply 107 after this rollback. This only removes
-- the bookkeeping row; no entitlement data is deleted.
DELETE FROM private.schema_migrations
 WHERE name = '107_entitlement_override_catalog_version.sql';

COMMIT;
