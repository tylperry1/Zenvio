-- Billing hardening: durable Stripe webhook event log, catalog sync runs, and
-- stored Stripe product ids for subscription prices.
-- Additive only. Never reprices, migrates, or cancels an existing subscription.

ALTER TABLE private.subscription_prices
  ADD COLUMN IF NOT EXISTS stripe_product_id text;

CREATE TABLE IF NOT EXISTS private.stripe_webhook_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  object_id text,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'processed', 'ignored', 'failed')),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  error text,
  livemode boolean,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stripe_webhook_events_status
  ON private.stripe_webhook_events (status, received_at DESC);
CREATE INDEX IF NOT EXISTS stripe_webhook_events_received
  ON private.stripe_webhook_events (received_at DESC);
REVOKE ALL ON private.stripe_webhook_events FROM public, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.billing_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment text NOT NULL CHECK (environment IN ('test', 'live', 'unknown')),
  catalog_version text NOT NULL,
  mode text NOT NULL,
  status text NOT NULL CHECK (status IN ('succeeded', 'failed')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  actor_id uuid REFERENCES public."user"(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS billing_sync_runs_recent
  ON private.billing_sync_runs (environment, started_at DESC);
REVOKE ALL ON private.billing_sync_runs FROM public, anon, authenticated;
