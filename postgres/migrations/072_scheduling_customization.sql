ALTER TABLE public.profiles ADD COLUMN availability_rules jsonb NOT NULL DEFAULT '{"noticeMinutes":120,"horizonDays":90,"intervalMinutes":15,"exceptions":[]}';
ALTER TABLE public.availability ADD COLUMN periods jsonb CHECK (periods IS NULL OR jsonb_typeof(periods)='array');
ALTER TABLE public.bookings ADD COLUMN location text CHECK (length(location)<=500);

CREATE FUNCTION private.booking_location_snapshot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF current_setting('zenvio.user_id',true)=NEW.user_id::text THEN
  NEW.location:=coalesce(NEW.location,nullif(current_setting('zenvio.booking_location',true),''));
 END IF;
 NEW.location:=coalesce(NEW.location,(SELECT e.location FROM public.event_types e WHERE e.id=NEW.event_id));
 RETURN NEW;
END;$$;
CREATE TRIGGER booking_location_snapshot BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION private.booking_location_snapshot();
REVOKE ALL ON FUNCTION private.booking_location_snapshot() FROM public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.public_slots(host_slug text,event_slug text,day_date date) RETURNS TABLE(starts_at timestamptz) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_id uuid; tz text; minutes integer; gap integer; rules jsonb; ranges jsonb; exception jsonb; workday public.availability%ROWTYPE;
BEGIN
 SELECT p.id,p.timezone,e.duration,e.buffer,p.availability_rules INTO owner_id,tz,minutes,gap,rules FROM public.profiles p JOIN public.event_types e ON e.user_id=p.id WHERE p.slug=$1 AND e.slug=$2 AND e.active AND e.deleted_at IS NULL;
 IF owner_id IS NULL THEN RETURN;END IF;
 IF day_date<(now() AT TIME ZONE tz)::date OR day_date>(now() AT TIME ZONE tz)::date+coalesce((rules->>'horizonDays')::integer,90) THEN RETURN;END IF;
 SELECT x.value INTO exception FROM jsonb_array_elements(coalesce(rules->'exceptions','[]'::jsonb)) x WHERE x.value->>'date'=day_date::text;
 IF exception IS NOT NULL THEN ranges:=exception->'periods';
 ELSE
  SELECT a.* INTO workday FROM public.availability a WHERE a.user_id=owner_id AND a.day=extract(dow FROM day_date)::integer AND a.enabled;
  IF workday.user_id IS NULL THEN RETURN;END IF;
  ranges:=coalesce(workday.periods,jsonb_build_array(jsonb_build_object('start',left(workday.start_time::text,5),'end',left(workday.end_time::text,5))));
 END IF;
 RETURN QUERY SELECT DISTINCT s.slot FROM jsonb_array_elements(ranges) r
 CROSS JOIN LATERAL generate_series((day_date+(r.value->>'start')::time) AT TIME ZONE tz,((day_date+(r.value->>'end')::time) AT TIME ZONE tz)-make_interval(mins=>minutes),make_interval(mins=>coalesce((rules->>'intervalMinutes')::integer,15))) s(slot)
 WHERE s.slot>=now()+make_interval(mins=>coalesce((rules->>'noticeMinutes')::integer,120))
 AND NOT EXISTS(SELECT 1 FROM public.bookings b WHERE b.user_id=owner_id AND b.status='confirmed' AND tstzrange(s.slot,s.slot+make_interval(mins=>minutes+gap),'[)')&&tstzrange(b.starts_at,b.blocked_until,'[)'))
 AND NOT EXISTS(SELECT 1 FROM private.appointment_payments h WHERE h.user_id=owner_id AND h.status IN ('held','pending') AND h.hold_expires_at>now() AND tstzrange(s.slot,s.slot+make_interval(mins=>minutes+gap),'[)')&&tstzrange(h.starts_at,h.ends_at+make_interval(mins=>h.buffer_minutes),'[)'))
 ORDER BY s.slot;
END;$$;

CREATE INDEX IF NOT EXISTS memberships_active_user ON private.memberships(user_id) WHERE active;
