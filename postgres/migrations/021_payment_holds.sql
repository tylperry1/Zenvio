ALTER TABLE private.appointment_payments ADD COLUMN last_error text,ADD COLUMN buffer_minutes integer NOT NULL DEFAULT 0;
CREATE TABLE private.appointment_refunds(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),payment_id uuid NOT NULL REFERENCES private.appointment_payments(id),amount_cents integer NOT NULL CHECK(amount_cents>0),stripe_refund_id text UNIQUE,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','succeeded','failed')),actor_id uuid,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON private.appointment_refunds FROM public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.public_slots(host_slug text,event_slug text,day_date date) RETURNS TABLE(starts_at timestamptz) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_id uuid; tz text; minutes integer; gap integer; opening time; closing time;
BEGIN
 SELECT p.id,p.timezone,e.duration,e.buffer INTO owner_id,tz,minutes,gap FROM public.profiles p JOIN public.event_types e ON e.user_id=p.id WHERE p.slug=$1 AND e.slug=$2 AND e.active AND e.deleted_at IS NULL;
 IF owner_id IS NULL THEN RETURN;END IF;
 IF day_date<(now() AT TIME ZONE tz)::date OR day_date>(now() AT TIME ZONE tz)::date+90 THEN RETURN;END IF;
 SELECT a.start_time,a.end_time INTO opening,closing FROM public.availability a WHERE a.user_id=owner_id AND a.day=extract(dow FROM day_date)::integer AND a.enabled;
 IF opening IS NULL THEN RETURN;END IF;
 RETURN QUERY SELECT s.slot FROM generate_series((day_date+opening) AT TIME ZONE tz,((day_date+closing) AT TIME ZONE tz)-make_interval(mins=>minutes),interval '15 minutes')s(slot)
 WHERE s.slot>=now()+interval '2 hours' AND NOT EXISTS(SELECT 1 FROM public.bookings b WHERE b.user_id=owner_id AND b.status='confirmed' AND tstzrange(s.slot,s.slot+make_interval(mins=>minutes+gap),'[)')&&tstzrange(b.starts_at,b.blocked_until,'[)'))
 AND NOT EXISTS(SELECT 1 FROM private.appointment_payments h WHERE h.user_id=owner_id AND h.status IN ('held','pending') AND h.hold_expires_at>now() AND tstzrange(s.slot,s.slot+make_interval(mins=>minutes+gap),'[)')&&tstzrange(h.starts_at,h.ends_at+make_interval(mins=>h.buffer_minutes),'[)'));
END;$$;
