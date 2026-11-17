-- Allow partial Stripe syncs to record an honest degraded connection status.
ALTER TABLE private.provider_cost_sync_state
  DROP CONSTRAINT IF EXISTS provider_cost_sync_state_connection_status_check;

ALTER TABLE private.provider_cost_sync_state
  ADD CONSTRAINT provider_cost_sync_state_connection_status_check
  CHECK (connection_status IN ('connected','degraded','unavailable','not_configured','error'));
