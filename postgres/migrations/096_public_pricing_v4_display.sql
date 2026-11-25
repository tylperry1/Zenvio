-- Publish the approved 2026-11-v4 plan catalog on public pricing surfaces.
-- Display only: paid enrollment stays gated by PRICING_V4_VALIDATED,
-- the persisted enrollmentEnabled switch, and Stripe readiness.
-- Existing subscriptions, prices, and contracts are untouched.

INSERT INTO private.platform_settings(key, value)
VALUES ('pricing_v4', '{"previewEnabled":true,"enrollmentEnabled":false,"publicCatalog":"v4"}'::jsonb)
ON CONFLICT (key) DO UPDATE
  SET value = jsonb_set(
        jsonb_set(
          coalesce(private.platform_settings.value, '{}'::jsonb),
          '{previewEnabled}',
          'true'::jsonb,
          true
        ),
        '{publicCatalog}',
        '"v4"'::jsonb,
        true
      ),
      updated_at = now();
