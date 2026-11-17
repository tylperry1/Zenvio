-- Validate CHECK constraints added NOT VALID in 086_pricing_v4_financial_intelligence.sql.
-- Runs as ShareUpdateExclusive so existing rows are scanned without AccessExclusive locks.

ALTER TABLE private.subscription_usage_reservations
  VALIDATE CONSTRAINT subscription_usage_reservations_meter_check;

ALTER TABLE private.subscription_credit_entries
  VALIDATE CONSTRAINT subscription_credit_entries_meter_check;

ALTER TABLE private.subscription_prices
  VALIDATE CONSTRAINT subscription_prices_plan_check;

ALTER TABLE private.entitlement_overrides
  VALIDATE CONSTRAINT entitlement_overrides_plan_check;
