-- Additive monthly packages. No existing subscription or recurring price is rewritten.
ALTER TABLE private.subscription_prices DROP CONSTRAINT subscription_prices_plan_check;
ALTER TABLE private.subscription_prices ADD CONSTRAINT subscription_prices_plan_check CHECK(plan IN ('pro','business','teams','individual','team','team_extra'));
ALTER TABLE private.entitlement_overrides DROP CONSTRAINT entitlement_overrides_plan_check;
ALTER TABLE private.entitlement_overrides ADD CONSTRAINT entitlement_overrides_plan_check CHECK(plan IN ('free','pro','business','teams','individual','team'));
CREATE OR REPLACE FUNCTION private.team_entitlement_roots(target uuid) RETURNS TABLE(owner_id uuid,seats integer) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH roots AS (SELECT target id UNION SELECT o.owner_id FROM private.memberships m JOIN private.organizations o ON o.id=m.organization_id WHERE m.user_id=target AND m.active)
 SELECT r.id,greatest(3,coalesce(s.seats,3)) FROM roots r LEFT JOIN private.subscriptions s ON s.user_id=r.id LEFT JOIN private.entitlement_overrides v ON v.user_id=r.id AND v.expires_at>now()
 WHERE v.plan IN ('teams','team') OR (v.plan IS NULL AND s.plan IN ('teams','team') AND s.status IN ('active','trialing') AND s.seats>=3);
$$;
CREATE OR REPLACE FUNCTION private.effective_plan(target uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT plan FROM private.entitlement_overrides WHERE user_id=target AND expires_at>now()),
 CASE WHEN EXISTS(SELECT 1 FROM private.team_entitlement_roots(target) r JOIN private.subscriptions s ON s.user_id=r.owner_id WHERE s.plan='team' AND s.status IN ('active','trialing')) THEN 'team' WHEN EXISTS(SELECT 1 FROM private.team_entitlement_roots(target)) THEN 'teams' END,
 (SELECT plan FROM private.subscriptions WHERE user_id=target AND status IN ('active','trialing') AND (plan NOT IN ('teams','team') OR seats>=3)),'free');
$$;
CREATE OR REPLACE FUNCTION private.guard_active_type() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE plan_id text; allowed integer; used integer;
BEGIN
 IF NOT NEW.active OR NEW.deleted_at IS NOT NULL OR (TG_OP='UPDATE' AND OLD.active AND OLD.deleted_at IS NULL) OR coalesce(current_setting('zenvio.team_internal',true),'')='true' THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('entitlements:'||NEW.user_id::text,0));
 plan_id:=private.effective_plan(NEW.user_id);
 allowed:=CASE plan_id WHEN 'pro' THEN 10 WHEN 'business' THEN 50 WHEN 'teams' THEN 100 WHEN 'individual' THEN 100 WHEN 'team' THEN 100 ELSE 1 END;
 SELECT count(*) INTO used FROM public.event_types e WHERE e.user_id=NEW.user_id AND e.active AND e.deleted_at IS NULL AND e.id<>NEW.id AND NOT EXISTS(SELECT 1 FROM private.team_event_staff t WHERE t.personal_event_id=e.id);
 IF used>=allowed THEN RAISE EXCEPTION 'invalid_active_type_limit';END IF;RETURN NEW;
END;$$;
