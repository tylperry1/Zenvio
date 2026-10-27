CREATE TABLE private.signature_envelopes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public."user"(id),
 title text NOT NULL, message text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','completed','voided','declined')),
 pdf bytea NOT NULL CHECK(octet_length(pdf)<=3000000), pages jsonb NOT NULL, fields jsonb NOT NULL DEFAULT '[]', content_hash text,
 created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, completed_at timestamptz, expires_at timestamptz
);
CREATE INDEX signature_envelopes_owner ON private.signature_envelopes(user_id,created_at DESC);
CREATE TABLE private.signature_recipients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), envelope_id uuid NOT NULL REFERENCES private.signature_envelopes(id),
 name text NOT NULL, email text NOT NULL, token_hash text UNIQUE, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','viewed','signed','declined')),
 signature_name text, signed_at timestamptz, receipt_hash text, answers jsonb NOT NULL DEFAULT '{}', UNIQUE(envelope_id,email)
);
CREATE TABLE private.signature_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),envelope_id uuid NOT NULL REFERENCES private.signature_envelopes(id),recipient_id uuid REFERENCES private.signature_recipients(id),
 action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),details jsonb NOT NULL DEFAULT '{}'
);
REVOKE ALL ON private.signature_envelopes,private.signature_recipients,private.signature_events FROM public,anon,authenticated;
