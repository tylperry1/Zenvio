-- Concurrent private storage, never a resetting monthly consumable. No file is deleted.
CREATE TABLE private.workspace_meter_overrides (
 billing_owner uuid NOT NULL REFERENCES public."user"(id), meter text NOT NULL CHECK(meter='storageBytes'),
 allowance bigint NOT NULL CHECK(allowance BETWEEN 0 AND 1000000000000),
 actor_id uuid NOT NULL REFERENCES public."user"(id), reason text NOT NULL CHECK(length(reason)>=8),
 expires_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(billing_owner,meter)
);
REVOKE ALL ON private.workspace_meter_overrides FROM public,anon,authenticated;
CREATE FUNCTION private.workspace_storage_bytes(owner uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH hosts AS (SELECT owner id UNION SELECT m.user_id FROM private.memberships m JOIN private.organizations o ON o.id=m.organization_id WHERE o.owner_id=owner AND m.active), sizes AS (
 SELECT coalesce(sum(octet_length(p.image)),0)::bigint n FROM private.profile_photos p WHERE p.user_id IN(SELECT id FROM hosts)
 UNION ALL SELECT coalesce(sum(octet_length(p.image)),0) FROM private.profile_images p WHERE p.user_id IN(SELECT id FROM hosts)
 UNION ALL SELECT coalesce(sum(octet_length(p.data)),0) FROM private.intake_uploads p WHERE p.user_id IN(SELECT id FROM hosts)
 UNION ALL SELECT coalesce(sum(octet_length(p.data)),0) FROM private.message_attachments p JOIN private.message_threads t ON t.id=p.thread_id WHERE t.user_id IN(SELECT id FROM hosts)
 UNION ALL SELECT coalesce(sum(octet_length(p.pdf)+coalesce(octet_length(p.completed_pdf),0)),0) FROM private.signature_envelopes p WHERE p.user_id IN(SELECT id FROM hosts)
 UNION ALL SELECT coalesce(sum(octet_length(p.signature_image)),0) FROM private.signature_recipients p JOIN private.signature_envelopes e ON e.id=p.envelope_id WHERE e.user_id IN(SELECT id FROM hosts)
 UNION ALL SELECT coalesce(sum(octet_length(p.pdf)),0) FROM private.pdf_template_versions p JOIN private.pdf_templates t ON t.id=p.template_id WHERE t.user_id IN(SELECT id FROM hosts)
 UNION ALL SELECT coalesce(sum(octet_length(p.image)),0) FROM private.marketplace_artwork p WHERE p.user_id IN(SELECT id FROM hosts)
 -- Failed/pending uploads may have reached the provider. Hold capacity until verified reconciliation.
 UNION ALL SELECT coalesce(sum(p.byte_size),0) FROM private.stored_files p WHERE p.user_id IN(SELECT id FROM hosts)
 ) SELECT coalesce(sum(n),0)::bigint FROM sizes;
$$;
CREATE FUNCTION private.guard_workspace_storage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE host uuid; owner uuid; current_owner uuid; old_bytes bigint:=0; new_bytes bigint:=0; cap bigint; version text; plan_id text; state text; lock_id uuid;
BEGIN
 IF TG_TABLE_NAME='message_attachments' THEN SELECT user_id INTO host FROM private.message_threads WHERE id=NEW.thread_id;
 ELSIF TG_TABLE_NAME='pdf_template_versions' THEN SELECT user_id INTO host FROM private.pdf_templates WHERE id=NEW.template_id;
 ELSIF TG_TABLE_NAME='signature_recipients' THEN SELECT user_id INTO host FROM private.signature_envelopes WHERE id=NEW.envelope_id;
 ELSE host:=(to_jsonb(NEW)->>'user_id')::uuid; END IF;
 IF host IS NULL THEN RETURN NEW; END IF;
 SELECT coalesce((SELECT owner_id FROM private.team_entitlement_roots(host) ORDER BY (owner_id=host) DESC,owner_id LIMIT 1),host) INTO owner;
 SELECT catalog_version,plan,status INTO version,plan_id,state FROM private.subscriptions WHERE user_id=owner;
 IF version IS DISTINCT FROM '2026-11-v3' OR EXISTS(SELECT 1 FROM private.platform_roles WHERE user_id=owner AND enabled) OR EXISTS(SELECT 1 FROM private.entitlement_overrides WHERE user_id=owner AND expires_at>now()) THEN RETURN NEW; END IF;
 -- Same stable lock order as team/seat changes.
 FOR lock_id IN SELECT DISTINCT id FROM unnest(ARRAY[host,owner]) id ORDER BY id LOOP
 PERFORM pg_advisory_xact_lock(hashtextextended('entitlements:'||lock_id::text,0)); END LOOP;
 SELECT coalesce((SELECT owner_id FROM private.team_entitlement_roots(host) ORDER BY (owner_id=host) DESC,owner_id LIMIT 1),host) INTO current_owner;
 IF current_owner<>owner THEN RAISE EXCEPTION 'storage_workspace_changed'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('storage:'||owner::text,0));
 SELECT catalog_version,plan,status INTO version,plan_id,state FROM private.subscriptions WHERE user_id=owner;
 IF TG_TABLE_NAME IN ('profile_photos','profile_images','marketplace_artwork') THEN new_bytes:=coalesce(octet_length(NEW.image),0); IF TG_OP='UPDATE' THEN old_bytes:=coalesce(octet_length(OLD.image),0);END IF;
 ELSIF TG_TABLE_NAME IN ('intake_uploads','message_attachments') THEN new_bytes:=octet_length(NEW.data);IF TG_OP='UPDATE' THEN old_bytes:=octet_length(OLD.data);END IF;
 ELSIF TG_TABLE_NAME='signature_envelopes' THEN new_bytes:=octet_length(NEW.pdf)+coalesce(octet_length(NEW.completed_pdf),0);IF TG_OP='UPDATE' THEN old_bytes:=octet_length(OLD.pdf)+coalesce(octet_length(OLD.completed_pdf),0);END IF;
 ELSIF TG_TABLE_NAME='signature_recipients' THEN new_bytes:=coalesce(octet_length(NEW.signature_image),0);IF TG_OP='UPDATE' THEN old_bytes:=coalesce(octet_length(OLD.signature_image),0);END IF;
 ELSIF TG_TABLE_NAME='pdf_template_versions' THEN new_bytes:=octet_length(NEW.pdf);IF TG_OP='UPDATE' THEN old_bytes:=octet_length(OLD.pdf);END IF;
 ELSIF TG_TABLE_NAME='stored_files' THEN new_bytes:=NEW.byte_size;IF TG_OP='UPDATE' THEN old_bytes:=OLD.byte_size;END IF;
 END IF;
 -- Finish evidence for an already-admitted envelope even if the optional upload quota is full.
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='signature_envelopes' THEN
 IF OLD.completed_pdf IS NULL AND NEW.completed_pdf IS NOT NULL AND NEW.pdf=OLD.pdf AND NEW.status='completed' THEN RETURN NEW;END IF; END IF;
 -- Status changes and shrinking/deleting data never destroy retained customer access.
 IF new_bytes<=old_bytes THEN RETURN NEW;END IF;
 cap:=CASE WHEN state IN ('active','trialing') THEN CASE plan_id WHEN 'team' THEN 10000000000 WHEN 'individual' THEN 2000000000 ELSE 0 END ELSE 0 END;
 SELECT coalesce((SELECT allowance FROM private.workspace_meter_overrides WHERE billing_owner=owner AND meter='storageBytes' AND expires_at>now()),cap) INTO cap;
 IF private.workspace_storage_bytes(owner)+new_bytes-old_bytes>cap THEN RAISE EXCEPTION 'workspace_storage_allowance_reached' USING ERRCODE='P0001';END IF;
 RETURN NEW;
END;$$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['profile_photos','profile_images','intake_uploads','message_attachments','signature_envelopes','signature_recipients','pdf_template_versions','marketplace_artwork','stored_files'] LOOP
 EXECUTE format('CREATE TRIGGER workspace_storage_quota BEFORE INSERT OR UPDATE ON private.%I FOR EACH ROW EXECUTE FUNCTION private.guard_workspace_storage()',t);
 END LOOP; END $$;
REVOKE ALL ON FUNCTION private.workspace_storage_bytes(uuid),private.guard_workspace_storage() FROM public,anon,authenticated;
