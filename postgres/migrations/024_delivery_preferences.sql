ALTER TABLE private.signature_envelopes ADD COLUMN reminder_days integer[] NOT NULL DEFAULT ARRAY[3,7];
ALTER TABLE private.signing_documents ADD COLUMN reminder_days integer[] NOT NULL DEFAULT ARRAY[3,7];
