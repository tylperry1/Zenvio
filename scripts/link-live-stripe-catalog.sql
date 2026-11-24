-- Link the live Stripe 2026-11-v4 catalog to the Zenvio application database.
--
-- Prerequisites:
--   * Migration 095 (subscription_prices.stripe_product_id) is applied.
--   * Run against the production database only, inside the approved change window.
--   * The Stripe key in the Integration Vault must be the LIVE key that owns these IDs.
--   * Review docs/stripe-live-catalog.md first. This file never deletes or deactivates anything.
--
-- Stripe objects were created in live mode on 2026-11-24. Existing v3 products,
-- prices, subscriptions, and invoices are untouched.

BEGIN;

INSERT INTO private.subscription_prices
  (plan, period, stripe_price_id, stripe_product_id, catalog_version)
VALUES
  ('starter',        'monthly', 'price_1Uf856QMz0wiUqo0uJsbCAd7', 'zenvio_starter_v4',        '2026-11-v4'),
  ('starter',        'annual',  'price_1Uf856QMz0wiUqo031WwUUOC', 'zenvio_starter_v4',        '2026-11-v4'),
  ('professional',   'monthly', 'price_1Uf856QMz0wiUqo01Os8BxRH', 'zenvio_professional_v4',   '2026-11-v4'),
  ('professional',   'annual',  'price_1Uf856QMz0wiUqo0Cg8swKNk', 'zenvio_professional_v4',   '2026-11-v4'),
  ('business',       'monthly', 'price_1Uf856QMz0wiUqo0Swg6Qqk0', 'zenvio_business_v4',       '2026-11-v4'),
  ('business',       'annual',  'price_1Uf856QMz0wiUqo03dCh5asi', 'zenvio_business_v4',       '2026-11-v4'),
  ('business_extra', 'monthly', 'price_1Uf856QMz0wiUqo0usROIFRC', 'zenvio_business_extra_v4', '2026-11-v4'),
  ('business_extra', 'annual',  'price_1Uf856QMz0wiUqo08pX6WTJv', 'zenvio_business_extra_v4', '2026-11-v4')
ON CONFLICT (plan, period) DO UPDATE
  SET stripe_price_id   = EXCLUDED.stripe_price_id,
      stripe_product_id = EXCLUDED.stripe_product_id,
      catalog_version   = EXCLUDED.catalog_version;

INSERT INTO private.subscription_price_history
  (stripe_price_id, plan, period, catalog_version)
SELECT stripe_price_id, plan, period, catalog_version
  FROM private.subscription_prices
 WHERE catalog_version = '2026-11-v4'
ON CONFLICT DO NOTHING;

-- Add-on mappings. Purchase stays gated by ADDON_BILLING_VALIDATED and the
-- per-row available flag. The seat add-on reuses the subscription seat product
-- so the catalog does not create a duplicate Stripe product.
UPDATE private.billing_addons AS a
   SET stripe_product_id = v.product_id,
       stripe_price_id   = v.price_id,
       sync_status       = 'synced',
       sync_error        = NULL,
       last_synced_at    = now(),
       updated_at        = now()
  FROM (VALUES
    ('ai_100',        'zenvio_addon_ai_100',        'price_1Uf85EQMz0wiUqo0iQw4PDVk'),
    ('ai_500',        'zenvio_addon_ai_500',        'price_1Uf85EQMz0wiUqo05lgnylml'),
    ('envelopes_10',  'zenvio_addon_envelopes_10',  'price_1Uf85EQMz0wiUqo0TobtfVwI'),
    ('envelope_1',    'zenvio_addon_envelope_1',    'price_1Uf85EQMz0wiUqo0zRBS3bD6'),
    ('video_1000',    'zenvio_addon_video_1000',    'price_1Uf85EQMz0wiUqo0WIOYh6uy'),
    ('storage_10gb',  'zenvio_addon_storage_10gb',  'price_1Uf85EQMz0wiUqo0SwGwRlu4'),
    ('sms_starter',   'zenvio_addon_sms_starter',   'price_1Uf85EQMz0wiUqo0oxQK8EBT'),
    ('sms_segment',   'zenvio_addon_sms_segment',   'price_1Uf85EQMz0wiUqo0oUCA0aO5'),
    ('business_extra','zenvio_business_extra_v4',   'price_1Uf856QMz0wiUqo0usROIFRC')
  ) AS v(addon_id, product_id, price_id)
 WHERE a.id = v.addon_id;

COMMIT;

-- Verification: expect 8 v4 plan/period mappings and 9 add-on mappings.
SELECT plan, period, stripe_product_id, stripe_price_id, catalog_version
  FROM private.subscription_prices
 WHERE catalog_version = '2026-11-v4'
 ORDER BY plan, period;

SELECT id, stripe_product_id, stripe_price_id, sync_status
  FROM private.billing_addons
 ORDER BY id;
