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
CREATE TABLE private.billing_change_dispatches(operation_id uuid PRIMARY KEY,actor_id uuid NOT NULL,user_id uuid NOT NULL,subscription_id text NOT NULL,request jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE private.billing_change_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.billing_change_dispatches FROM public,anon,authenticated;
CREATE OR REPLACE FUNCTION private.guard_workspace_storage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE host uuid; owner uuid; current_owner uuid; old_bytes bigint:=0; new_bytes bigint:=0; cap bigint; version text; plan_id text; state text; lock_id uuid;
BEGIN
 IF TG_TABLE_NAME='design_proofs' THEN SELECT user_id INTO host FROM private.saved_designs WHERE id=NEW.design_id;
 ELSIF TG_TABLE_NAME='message_attachments' THEN SELECT user_id INTO host FROM private.message_threads WHERE id=NEW.thread_id;
 ELSIF TG_TABLE_NAME='pdf_template_versions' THEN SELECT user_id INTO host FROM private.pdf_templates WHERE id=NEW.template_id;
 ELSIF TG_TABLE_NAME='signature_recipients' THEN SELECT user_id INTO host FROM private.signature_envelopes WHERE id=NEW.envelope_id;
 ELSE host:=(to_jsonb(NEW)->>'user_id')::uuid; END IF;
 IF host IS NULL THEN RETURN NEW; END IF;
 SELECT coalesce((SELECT owner_id FROM private.team_entitlement_roots(host) ORDER BY (owner_id=host) DESC,owner_id LIMIT 1),host) INTO owner;
 SELECT catalog_version,plan,status INTO version,plan_id,state FROM private.subscriptions WHERE user_id=owner;
 IF (version IS DISTINCT FROM '2026-11-v3' AND coalesce(version NOT LIKE 'release-%',true)) OR EXISTS(SELECT 1 FROM private.platform_roles WHERE user_id=owner AND enabled) OR EXISTS(SELECT 1 FROM private.entitlement_overrides WHERE user_id=owner AND expires_at>now()) THEN RETURN NEW; END IF;
 -- Same stable lock order as team/seat changes.
 FOR lock_id IN SELECT DISTINCT id FROM unnest(ARRAY[host,owner]) id ORDER BY id LOOP
 PERFORM pg_advisory_xact_lock(hashtextextended('entitlements:'||lock_id::text,0)); END LOOP;
 SELECT coalesce((SELECT owner_id FROM private.team_entitlement_roots(host) ORDER BY (owner_id=host) DESC,owner_id LIMIT 1),host) INTO current_owner;
 IF current_owner<>owner THEN RAISE EXCEPTION 'storage_workspace_changed'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('storage:'||owner::text,0));
 SELECT catalog_version,plan,status INTO version,plan_id,state FROM private.subscriptions WHERE user_id=owner;
 IF TG_TABLE_NAME IN ('profile_photos','profile_images','marketplace_artwork','brand_assets') THEN new_bytes:=coalesce(octet_length(NEW.image),0); IF TG_OP='UPDATE' THEN old_bytes:=coalesce(octet_length(OLD.image),0);END IF;
 ELSIF TG_TABLE_NAME IN ('intake_uploads','message_attachments') THEN new_bytes:=octet_length(NEW.data);IF TG_OP='UPDATE' THEN old_bytes:=octet_length(OLD.data);END IF;
 ELSIF TG_TABLE_NAME='signature_envelopes' THEN new_bytes:=octet_length(NEW.pdf)+coalesce(octet_length(NEW.completed_pdf),0);IF TG_OP='UPDATE' THEN old_bytes:=octet_length(OLD.pdf)+coalesce(octet_length(OLD.completed_pdf),0);END IF;
 ELSIF TG_TABLE_NAME='signature_recipients' THEN new_bytes:=coalesce(octet_length(NEW.signature_image),0);IF TG_OP='UPDATE' THEN old_bytes:=coalesce(octet_length(OLD.signature_image),0);END IF;
 ELSIF TG_TABLE_NAME='pdf_template_versions' THEN new_bytes:=octet_length(NEW.pdf);IF TG_OP='UPDATE' THEN old_bytes:=octet_length(OLD.pdf);END IF;
 ELSIF TG_TABLE_NAME='design_proofs' THEN new_bytes:=octet_length(NEW.file);IF TG_OP='UPDATE' THEN old_bytes:=octet_length(OLD.file);END IF;
 ELSIF TG_TABLE_NAME='stored_files' THEN new_bytes:=NEW.byte_size;IF TG_OP='UPDATE' THEN old_bytes:=OLD.byte_size;END IF;
 END IF;
 -- Finish evidence for an already-admitted envelope even if the optional upload quota is full.
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='signature_envelopes' THEN
 IF OLD.completed_pdf IS NULL AND NEW.completed_pdf IS NOT NULL AND NEW.pdf=OLD.pdf AND NEW.status='completed' THEN RETURN NEW;END IF; END IF;
 -- Status changes and shrinking/deleting data never destroy retained customer access.
 IF new_bytes<=old_bytes THEN RETURN NEW;END IF;
 IF version LIKE 'release-%' THEN
 SELECT coalesce((catalog->'allowances'->plan_id->>'storageBytes')::bigint,0) INTO cap FROM private.billing_catalog_versions WHERE id=substring(version FROM 9)::uuid;
 cap:=CASE WHEN state IN ('active','trialing') THEN coalesce(cap,0) ELSE 0 END;
 ELSE cap:=CASE WHEN state IN ('active','trialing') THEN CASE plan_id WHEN 'team' THEN 10000000000 WHEN 'individual' THEN 2000000000 ELSE 0 END ELSE 0 END;END IF;
 SELECT coalesce((SELECT allowance FROM private.workspace_meter_overrides WHERE billing_owner=owner AND meter='storageBytes' AND expires_at>now()),cap) INTO cap;
 IF private.workspace_storage_bytes(owner)+new_bytes-old_bytes>cap THEN RAISE EXCEPTION 'workspace_storage_allowance_reached' USING ERRCODE='P0001';END IF;
 RETURN NEW;
END;$$;

COMMIT;
