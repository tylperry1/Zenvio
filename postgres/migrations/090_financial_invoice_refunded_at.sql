-- Attribute invoice refunds to when they were observed, not the original paid_at.
-- Additive only. No Stripe mutations.

ALTER TABLE private.financial_invoice_snapshots
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

CREATE INDEX IF NOT EXISTS financial_invoice_refunded_idx
  ON private.financial_invoice_snapshots(refunded_at, currency)
  WHERE amount_refunded_cents > 0;
