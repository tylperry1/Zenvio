ALTER TABLE private.entitlement_overrides
  ADD COLUMN IF NOT EXISTS catalog_version text;

COMMENT ON COLUMN private.entitlement_overrides.catalog_version IS
  'Catalog that defines the granted plan. Null keeps legacy plan behavior.';
