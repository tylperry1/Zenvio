-- Single billing catalog cleanup.
--
-- Additive and staged. Existing subscriptions, invoices, price mappings and
-- payment history are untouched. The retired `pricing_v4` settings key is copied
-- to the permanent `billing` key, and promotion/add-on target labels are moved
-- from catalog versions to the one canonical plan catalog.

INSERT INTO private.platform_settings(key,value)
SELECT
  'billing',
  jsonb_build_object(
    'enrollmentEnabled',
    COALESCE((value->>'enrollmentEnabled')::boolean, false)
  )
FROM private.platform_settings
WHERE key = 'pricing_v4'
ON CONFLICT (key) DO NOTHING;

-- No current code reads these retired rate/promotion settings. Remove them only
-- after the new key exists so enrollment state is never lost.
DELETE FROM private.platform_settings
WHERE key IN ('pricing', 'pricing_v3_launch_promotion');

-- Promotion codes and add-ons now target the canonical plan catalog. Existing
-- targets are normalized before the tightened constraint is installed.
DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname, conrelid::regclass AS relation
    FROM pg_constraint
    WHERE conrelid IN ('private.billing_coupons'::regclass, 'private.billing_addons'::regclass)
      AND pg_get_constraintdef(oid) LIKE '%catalog_targets%'
  LOOP
    EXECUTE format(
      'ALTER TABLE %s DROP CONSTRAINT %I',
      constraint_row.relation,
      constraint_row.conname
    );
  END LOOP;
END
$$;

UPDATE private.billing_coupons
SET catalog_targets = ARRAY['plans']
WHERE catalog_targets IS NULL OR catalog_targets && ARRAY['v3','v4'];

UPDATE private.billing_addons
SET catalog_targets = ARRAY['plans']
WHERE catalog_targets IS NULL OR catalog_targets && ARRAY['v3','v4'];

ALTER TABLE private.billing_coupons
  ALTER COLUMN catalog_targets SET DEFAULT ARRAY['plans'],
  ADD CONSTRAINT billing_coupons_catalog_targets_check
    CHECK (catalog_targets = ARRAY['plans']::text[]);

ALTER TABLE private.billing_addons
  ALTER COLUMN catalog_targets SET DEFAULT ARRAY['plans'],
  ADD CONSTRAINT billing_addons_catalog_targets_check
    CHECK (catalog_targets = ARRAY['plans']::text[]);
