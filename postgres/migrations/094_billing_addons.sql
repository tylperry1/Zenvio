-- Durable platform add-on catalog with Stripe product/price mappings.
-- Editable from Master Admin → Billing. Defaults available=false (purchase still gated by ADDON_BILLING_VALIDATED).
-- Additive only. Does not enable purchase or flip env flags.

CREATE TABLE IF NOT EXISTS private.billing_addons (
  id text PRIMARY KEY,
  name text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0 AND amount_cents <= 100000000),
  quantity bigint NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  recurring boolean NOT NULL DEFAULT false,
  available boolean NOT NULL DEFAULT false,
  catalog_targets text[] NOT NULL DEFAULT '{v3,v4}'
    CHECK (catalog_targets <@ ARRAY['v3','v4']::text[] AND cardinality(catalog_targets) >= 1),
  stripe_product_id text,
  stripe_price_id text,
  sync_status text NOT NULL DEFAULT 'pending'
    CHECK (sync_status IN ('synced','pending','failed','disabled')),
  sync_error text,
  updated_by uuid REFERENCES public."user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz
);
CREATE INDEX IF NOT EXISTS billing_addons_sync_status
  ON private.billing_addons (sync_status, updated_at DESC);
REVOKE ALL ON private.billing_addons FROM public, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.billing_addon_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  addon_id text REFERENCES private.billing_addons(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES public."user"(id),
  action text NOT NULL,
  before_state jsonb,
  after_state jsonb,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_addon_audit_addon
  ON private.billing_addon_audit (addon_id, created_at DESC);
REVOKE ALL ON private.billing_addon_audit FROM public, anon, authenticated;

-- Seed approved catalog (idempotent). SMS + recurring stay unavailable until fulfillment acceptance.
INSERT INTO private.billing_addons(id,name,amount_cents,quantity,unit,recurring,available,catalog_targets,sync_status)
VALUES
  ('ai_100','100 AI credits',299,100,'aiCredits',false,false,'{v3,v4}','pending'),
  ('ai_500','500 AI credits',999,500,'aiCredits',false,false,'{v3,v4}','pending'),
  ('envelopes_10','10 additional e-sign envelopes',999,10,'envelopes',false,false,'{v3,v4}','pending'),
  ('envelope_1','Individual e-sign envelope',100,1,'envelopes',false,false,'{v3,v4}','pending'),
  ('video_1000','1,000 video minutes',999,1000,'videoMinutes',false,false,'{v3,v4}','pending'),
  ('storage_10gb','Additional 10 GB storage',299,10737418240,'storageBytes',true,false,'{v3,v4}','pending'),
  ('sms_starter','SMS Starter · 300 US segments',1499,300,'smsSegments',true,false,'{v3,v4}','pending'),
  ('sms_segment','Additional SMS segments',3,1,'smsSegments',false,false,'{v3,v4}','pending'),
  ('business_extra','Extra team member',500,1,'seats',true,false,'{v4}','pending')
ON CONFLICT (id) DO NOTHING;
