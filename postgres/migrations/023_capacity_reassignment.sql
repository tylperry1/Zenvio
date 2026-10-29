CREATE FUNCTION private.guard_active_type() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE plan_id text; allowed integer; used integer;
BEGIN
 IF NOT NEW.active OR NEW.deleted_at IS NOT NULL OR (TG_OP='UPDATE' AND OLD.active AND OLD.deleted_at IS NULL) OR coalesce(current_setting('zenvio.team_internal',true),'')='true' THEN RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('entitlements:'||NEW.user_id::text,0));
 SELECT coalesce((SELECT o.plan FROM private.entitlement_overrides o WHERE o.user_id=NEW.user_id AND o.expires_at>now()),(SELECT s.plan FROM private.subscriptions s WHERE s.user_id=NEW.user_id AND s.status IN ('active','trialing')),'free') INTO plan_id;
 allowed:=CASE plan_id WHEN 'pro' THEN 10 WHEN 'business' THEN 50 WHEN 'teams' THEN 100 ELSE 1 END;
 SELECT count(*) INTO used FROM public.event_types e WHERE e.user_id=NEW.user_id AND e.active AND e.deleted_at IS NULL AND e.id<>NEW.id AND NOT EXISTS(SELECT 1 FROM private.team_event_staff t WHERE t.personal_event_id=e.id);
 IF used>=allowed THEN RAISE EXCEPTION 'invalid_active_type_limit';END IF;RETURN NEW;
END;$$;
CREATE TRIGGER enforce_active_type_capacity BEFORE INSERT OR UPDATE OF active ON public.event_types FOR EACH ROW EXECUTE FUNCTION private.guard_active_type();
CREATE FUNCTION private.guard_booking_hold() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status='confirmed' THEN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,0));
 IF EXISTS(SELECT 1 FROM private.appointment_payments h WHERE h.user_id=NEW.user_id AND h.status IN ('held','pending') AND h.hold_expires_at>now() AND tstzrange(NEW.starts_at,NEW.blocked_until,'[)')&&tstzrange(h.starts_at,h.ends_at+make_interval(mins=>h.buffer_minutes),'[)')) THEN RAISE EXCEPTION 'slot_unavailable';END IF;END IF;RETURN NEW;
END;$$;
CREATE TRIGGER booking_payment_hold BEFORE INSERT OR UPDATE OF starts_at,ends_at,user_id,status ON public.bookings FOR EACH ROW EXECUTE FUNCTION private.guard_booking_hold();
CREATE TABLE private.google_calendar_cleanup(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES public."user"(id),account_sub text NOT NULL,event_id text NOT NULL,booking_id uuid NOT NULL REFERENCES public.bookings(id),attempts integer NOT NULL DEFAULT 0,last_error text,completed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,account_sub,event_id,booking_id));
REVOKE ALL ON private.google_calendar_cleanup FROM public,anon,authenticated;
