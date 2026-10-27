CREATE TABLE private.signing_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(length(title) BETWEEN 2 AND 150),content text NOT NULL CHECK(length(content) BETWEEN 10 AND 9000),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.signing_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES public."user"(id),
 booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 2 AND 150),content text NOT NULL CHECK(length(content) BETWEEN 10 AND 9000),
 recipient_name text NOT NULL,recipient_email text NOT NULL,content_hash text NOT NULL,
 token_hash text NOT NULL UNIQUE,status text NOT NULL DEFAULT 'awaiting_signature' CHECK(status IN ('awaiting_signature','signed','voided')),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '14 days',created_at timestamptz NOT NULL DEFAULT now(),
 signed_at timestamptz,signature_name text,receipt_hash text,
 CHECK((status='signed' AND signed_at IS NOT NULL AND signature_name IS NOT NULL AND receipt_hash IS NOT NULL) OR status<>'signed')
);
CREATE INDEX signing_documents_owner ON private.signing_documents(user_id,created_at DESC);
CREATE TABLE private.signing_activity (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid NOT NULL REFERENCES private.signing_documents(id),
 action text NOT NULL CHECK(action IN ('created','viewed','signed','voided')),created_at timestamptz NOT NULL DEFAULT now(),details jsonb NOT NULL DEFAULT '{}'
);
REVOKE ALL ON private.signing_templates,private.signing_documents,private.signing_activity FROM public,anon,authenticated;
