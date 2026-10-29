ALTER TABLE private.signing_documents ADD COLUMN contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;
CREATE TABLE private.client_activity(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES public."user"(id),contact_id uuid NOT NULL REFERENCES public.contacts(id),action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON private.client_activity FROM public,anon,authenticated;
