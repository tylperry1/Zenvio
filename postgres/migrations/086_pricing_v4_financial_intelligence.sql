-- Pricing v4 preview + Financial Intelligence foundations.
-- Does not reprice or migrate existing subscriptions. Activation stays gated.

-- Expand usage meters for v4 allowances (existing meters remain valid).
-- Add replacement CHECKs as NOT VALID to avoid long AccessExclusive locks; 087 validates.
ALTER TABLE private.subscription_usage_reservations
  DROP CONSTRAINT IF EXISTS subscription_usage_reservations_meter_check;
ALTER TABLE private.subscription_usage_reservations
  ADD CONSTRAINT subscription_usage_reservations_meter_check
  CHECK (meter IN (
    'aiCredits','videoMinutes','emails','smsSegments','storageBytes','envelopes',
    'marketingEmails','automationExecutions','apiCalls','contacts','appointments'
  )) NOT VALID;

ALTER TABLE private.subscription_credit_entries
  DROP CONSTRAINT IF EXISTS subscription_credit_entries_meter_check;
ALTER TABLE private.subscription_credit_entries
  ADD CONSTRAINT subscription_credit_entries_meter_check
  CHECK (meter IN (
    'aiCredits','videoMinutes','emails','smsSegments','storageBytes','envelopes',
    'marketingEmails','automationExecutions','apiCalls','contacts','appointments'
  )) NOT VALID;

-- Allow proposed plan ids on price mappings and overrides (enrollment still gated).
ALTER TABLE private.subscription_prices
  DROP CONSTRAINT IF EXISTS subscription_prices_plan_check;
ALTER TABLE private.subscription_prices
  ADD CONSTRAINT subscription_prices_plan_check
  CHECK (plan IN (
    'pro','business','teams','individual','team','team_extra',
    'free','starter','professional','business_extra','enterprise'
  )) NOT VALID;

ALTER TABLE private.entitlement_overrides
  DROP CONSTRAINT IF EXISTS entitlement_overrides_plan_check;
ALTER TABLE private.entitlement_overrides
  ADD CONSTRAINT entitlement_overrides_plan_check
  CHECK (plan IN (
    'free','pro','business','teams','individual','team',
    'starter','professional','enterprise'
  )) NOT VALID;

-- Provider cost budgets, manual expenses, and sync status for Financial Intelligence.
CREATE TABLE IF NOT EXISTS private.provider_cost_budgets (
  provider text PRIMARY KEY,
  monthly_budget_cents integer NOT NULL CHECK (monthly_budget_cents >= 0),
  alert_thresholds integer[] NOT NULL DEFAULT '{50,75,90,100}',
  currency text NOT NULL DEFAULT 'usd',
  updated_by uuid REFERENCES public."user"(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL DEFAULT ''
);
REVOKE ALL ON private.provider_cost_budgets FROM public, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.provider_cost_manual_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  category text NOT NULL,
  description text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'usd',
  period_start date NOT NULL,
  period_end date NOT NULL,
  classification text NOT NULL DEFAULT 'manual'
    CHECK (classification IN ('manual','invoice_import','estimate')),
  source_reference text,
  created_by uuid NOT NULL REFERENCES public."user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  void_reason text
);
CREATE INDEX IF NOT EXISTS provider_cost_manual_period
  ON private.provider_cost_manual_expenses(period_start, period_end, provider)
  WHERE voided_at IS NULL;
REVOKE ALL ON private.provider_cost_manual_expenses FROM public, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.provider_cost_sync_state (
  provider text PRIMARY KEY,
  connection_status text NOT NULL DEFAULT 'not_configured'
    CHECK (connection_status IN ('connected','unavailable','not_configured','error')),
  last_sync_at timestamptz,
  last_error text,
  pricing_model jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.provider_cost_sync_state FROM public, anon, authenticated;

INSERT INTO private.provider_cost_sync_state(provider, connection_status) VALUES
  ('vercel', 'not_configured'),
  ('database', 'not_configured'),
  ('resend', 'not_configured'),
  ('anthropic', 'not_configured'),
  ('stripe', 'not_configured'),
  ('storage', 'not_configured'),
  ('document_processing', 'not_configured'),
  ('sms', 'not_configured')
ON CONFLICT (provider) DO NOTHING;

INSERT INTO private.platform_settings(key, value) VALUES
  ('pricing_v4', '{"previewEnabled":false,"enrollmentEnabled":false,"publicCatalog":"v3"}'::jsonb),
  ('platform_operating_budget', '{"monthlyBudgetCents":0,"alertThresholds":[50,75,90,100],"currency":"usd"}'::jsonb)
ON CONFLICT (key) DO NOTHING;
