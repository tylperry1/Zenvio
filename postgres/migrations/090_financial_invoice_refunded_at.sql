-- Attribute invoice refunds to when they happened, not the original paid_at.
-- Additive only. No Stripe mutations.

ALTER TABLE private.financial_invoice_snapshots
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

CREATE INDEX IF NOT EXISTS financial_invoice_refunded_idx
  ON private.financial_invoice_snapshots(refunded_at, currency)
  WHERE amount_refunded_cents > 0;

-- One row per Stripe refund (or credit-note fallback) so multi-refund invoices
-- keep each amount in its own period instead of rewriting earlier totals.
CREATE TABLE IF NOT EXISTS private.financial_invoice_refund_events (
  stripe_refund_id text PRIMARY KEY,
  stripe_invoice_id text NOT NULL REFERENCES private.financial_invoice_snapshots(stripe_invoice_id) ON DELETE CASCADE,
  currency text NOT NULL DEFAULT 'usd',
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  refunded_at timestamptz NOT NULL,
  reconciled_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS financial_invoice_refund_events_period_idx
  ON private.financial_invoice_refund_events(refunded_at, currency);
CREATE INDEX IF NOT EXISTS financial_invoice_refund_events_invoice_idx
  ON private.financial_invoice_refund_events(stripe_invoice_id);
REVOKE ALL ON private.financial_invoice_refund_events FROM public, anon, authenticated;
