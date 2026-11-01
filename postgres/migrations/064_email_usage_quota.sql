CREATE TABLE private.email_usage_events (
 reference text PRIMARY KEY, billing_owner uuid REFERENCES public."user"(id), user_id uuid REFERENCES public."user"(id),
 kind text NOT NULL, protected boolean NOT NULL DEFAULT false, recipient_hash text,
 subscription_usage_id uuid REFERENCES private.subscription_usage_reservations(id),
 provider_id text UNIQUE, state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','accepted','uncertain')),
 created_at timestamptz NOT NULL DEFAULT now(),accepted_at timestamptz
);
CREATE INDEX email_usage_owner_period ON private.email_usage_events(billing_owner,created_at);
CREATE INDEX email_usage_global_period ON private.email_usage_events(created_at);
CREATE INDEX email_usage_recipient ON private.email_usage_events(recipient_hash,created_at) WHERE protected;
REVOKE ALL ON private.email_usage_events FROM public,anon,authenticated;
