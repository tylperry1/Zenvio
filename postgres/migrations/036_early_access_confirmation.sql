-- Waitlist confirmations use the existing private, encrypted delivery outbox.
ALTER TABLE private.delivery_jobs ADD COLUMN early_access_id uuid REFERENCES private.early_access_signups(id) ON DELETE CASCADE;
ALTER TABLE private.delivery_jobs ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE private.delivery_jobs ADD CONSTRAINT delivery_jobs_owner_required CHECK(user_id IS NOT NULL OR (kind='early_access_confirmation' AND early_access_id IS NOT NULL));
CREATE INDEX delivery_jobs_early_access ON private.delivery_jobs(early_access_id) WHERE early_access_id IS NOT NULL;
