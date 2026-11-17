-- Financial Intelligence sync stores: invoice cash snapshots + sync run audit.
-- Additive only. Does not mutate Stripe or reprice subscriptions.

CREATE TABLE IF NOT EXISTS private.financial_invoice_snapshots (
  stripe_invoice_id text PRIMARY KEY,
  user_id uuid REFERENCES public."user"(id) ON DELETE SET NULL,
  customer_id text NOT NULL,
  status text,
  billing_reason text,
  currency text NOT NULL DEFAULT 'usd',
  amount_paid_cents integer NOT NULL DEFAULT 0 CHECK (amount_paid_cents >= 0),
  amount_due_cents integer NOT NULL DEFAULT 0 CHECK (amount_due_cents >= 0),
  amount_remaining_cents integer NOT NULL DEFAULT 0 CHECK (amount_remaining_cents >= 0),
  amount_refunded_cents integer NOT NULL DEFAULT 0 CHECK (amount_refunded_cents >= 0),
  subtotal_cents integer,
  total_cents integer,
  subscription_id text,
  paid boolean NOT NULL DEFAULT false,
  attempted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  paid_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  hosted_invoice_url text,
  classification text NOT NULL DEFAULT 'cash'
    CHECK (classification IN ('cash','open','failed','refunded','void','uncollectible','unknown')),
  reconciled_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS financial_invoice_paid_idx
  ON private.financial_invoice_snapshots(paid_at, currency)
  WHERE paid = true;
CREATE INDEX IF NOT EXISTS financial_invoice_status_idx
  ON private.financial_invoice_snapshots(status, created_at);
CREATE INDEX IF NOT EXISTS financial_invoice_user_idx
  ON private.financial_invoice_snapshots(user_id, created_at);
REVOKE ALL ON private.financial_invoice_snapshots FROM public, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.financial_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN (
    'stripe_subscriptions','stripe_invoices','provider_costs','full'
  )),
  status text NOT NULL CHECK (status IN ('running','succeeded','failed','partial')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  actor_id uuid REFERENCES public."user"(id),
  processed integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text
);
CREATE INDEX IF NOT EXISTS financial_sync_runs_started_idx
  ON private.financial_sync_runs(started_at DESC);
REVOKE ALL ON private.financial_sync_runs FROM public, anon, authenticated;

-- Expand known infrastructure providers for cost tracking (manual until APIs connect).
INSERT INTO private.provider_cost_sync_state(provider, connection_status) VALUES
  ('neon', 'not_configured'),
  ('openai', 'not_configured'),
  ('gemini', 'not_configured'),
  ('google', 'not_configured'),
  ('daily', 'not_configured'),
  ('telnyx', 'not_configured')
ON CONFLICT (provider) DO NOTHING;
