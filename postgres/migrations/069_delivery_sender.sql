BEGIN;
-- Freeze the sender before attempting delivery, keeping retries identical.
ALTER TABLE private.delivery_jobs ADD COLUMN sender text;
COMMIT;
