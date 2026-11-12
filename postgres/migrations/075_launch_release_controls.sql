BEGIN;
ALTER TABLE public."user" ADD COLUMN deactivated_at timestamptz;
CREATE TABLE private.billing_catalog_versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),state text NOT NULL CHECK(state IN ('draft','published','superseded')),catalog jsonb NOT NULL,created_by uuid NOT NULL REFERENCES public."user"(id),created_at timestamptz NOT NULL DEFAULT now(),published_at timestamptz);
CREATE UNIQUE INDEX billing_single_published_catalog ON private.billing_catalog_versions((state)) WHERE state='published';
CREATE TABLE private.billing_admin_operations(id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES public."user"(id),action text NOT NULL,payload_hash text NOT NULL,state text NOT NULL CHECK(state IN ('pending','succeeded','failed')),result jsonb,error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE private.billing_catalog_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.billing_admin_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.billing_catalog_versions,private.billing_admin_operations FROM public,anon,authenticated;
CREATE TABLE private.stripe_sandbox_runs(id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES public."user"(id),api_passed boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE private.stripe_sandbox_events(id text PRIMARY KEY,run_id uuid NOT NULL REFERENCES private.stripe_sandbox_runs(id),kind text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE private.stripe_sandbox_runs ENABLE ROW LEVEL SECURITY;ALTER TABLE private.stripe_sandbox_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.stripe_sandbox_runs,private.stripe_sandbox_events FROM public,anon,authenticated;
CREATE FUNCTION private.guard_account_session() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE disabled timestamptz;
BEGIN SELECT deactivated_at INTO disabled FROM public."user" WHERE id=NEW."userId" FOR SHARE;
IF disabled IS NOT NULL THEN RAISE EXCEPTION 'invalid_deactivated_account';END IF;RETURN NEW;END;$$;
CREATE TRIGGER guard_account_session BEFORE INSERT ON public.session FOR EACH ROW EXECUTE FUNCTION private.guard_account_session();
REVOKE ALL ON FUNCTION private.guard_account_session() FROM public,anon,authenticated;
COMMIT;
