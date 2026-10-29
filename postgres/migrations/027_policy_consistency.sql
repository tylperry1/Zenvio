CREATE OR REPLACE FUNCTION private.guard_active_type() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE plan_id text; allowed integer; used integer;
BEGIN
 IF NOT NEW.active OR NEW.deleted_at IS NOT NULL OR (TG_OP='UPDATE' AND OLD.active AND OLD.deleted_at IS NULL) OR coalesce(current_setting('zenvio.team_internal',true),'')='true' THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('entitlements:'||NEW.user_id::text,0));
 SELECT coalesce((SELECT o.plan FROM private.entitlement_overrides o WHERE o.user_id=NEW.user_id AND o.expires_at>now()),(SELECT s.plan FROM private.subscriptions s WHERE s.user_id=NEW.user_id AND s.status IN ('active','trialing') AND (s.plan<>'teams' OR s.seats>=3)),'free') INTO plan_id;
 allowed:=CASE plan_id WHEN 'pro' THEN 10 WHEN 'business' THEN 50 WHEN 'teams' THEN 100 ELSE 1 END;
 SELECT count(*) INTO used FROM public.event_types e WHERE e.user_id=NEW.user_id AND e.active AND e.deleted_at IS NULL AND e.id<>NEW.id AND NOT EXISTS(SELECT 1 FROM private.team_event_staff t WHERE t.personal_event_id=e.id);
 IF used>=allowed THEN RAISE EXCEPTION 'invalid_active_type_limit';END IF;RETURN NEW;
END;$$;

ALTER TABLE private.signing_activity DROP CONSTRAINT signing_activity_action_check;
ALTER TABLE private.signing_activity ADD CONSTRAINT signing_activity_action_check CHECK(action IN ('created','viewed','signed','voided','invitation_queued'));
