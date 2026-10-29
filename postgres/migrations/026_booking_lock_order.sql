-- Acquire host locks before event or appointment row locks.
CREATE OR REPLACE FUNCTION public.reserve_booking_intake(host_slug text,event_slug text,slot_start timestamptz,visitor_name text,visitor_email text,visitor_notes text,visitor_phone text,visitor_company text,visitor_purpose text,answers_snapshot jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; schema_questions jsonb; actual_schema jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p.id::text,0)) FROM public.profiles p WHERE p.slug=$1;
 SELECT e.intake_questions INTO schema_questions FROM public.event_types e JOIN public.profiles p ON p.id=e.user_id WHERE p.slug=$1 AND e.slug=$2 AND e.active AND e.deleted_at IS NULL FOR SHARE OF e;
 SELECT coalesce(jsonb_agg(x.value-'answer'),'[]'::jsonb) INTO actual_schema FROM jsonb_array_elements(answers_snapshot) x;
 IF schema_questions IS DISTINCT FROM actual_schema THEN RAISE EXCEPTION 'invalid_booking_form_changed';END IF;
 result:=public.reserve_booking_details($1,$2,$3,$4,$5,$6,$7,$8,$9);
 UPDATE public.bookings b SET intake_snapshot=answers_snapshot,contact_id=(SELECT c.id FROM public.contacts c WHERE c.user_id=b.user_id AND c.email=b.guest_email) WHERE b.id=(result->>'id')::uuid;
 RETURN result;END;$$;

CREATE OR REPLACE FUNCTION private.move_booking(target uuid,new_start timestamptz,actor uuid,guest_token uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE b public.bookings; e public.event_types; p public.profiles; opening time; closing time; local_day date; minutes integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(user_id::text,0)) FROM public.bookings WHERE id=target;
 SELECT * INTO b FROM public.bookings WHERE id=target FOR UPDATE;
 IF NOT FOUND OR NOT(actor=b.user_id OR (actor IS NULL AND guest_token=b.cancel_token)) THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(b.user_id::text,0));
 SELECT * INTO e FROM public.event_types WHERE id=b.event_id FOR SHARE;SELECT * INTO p FROM public.profiles WHERE id=b.user_id;
 IF b.status<>'confirmed' OR b.starts_at<=now() OR NOT e.active OR e.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'not_found';END IF;
 IF actor IS NULL AND b.starts_at<now()+make_interval(mins=>e.reschedule_notice_minutes) THEN RAISE EXCEPTION 'reschedule_policy';END IF;
 local_day:=(new_start AT TIME ZONE p.timezone)::date;minutes:=extract(epoch FROM b.ends_at-b.starts_at)/60;
 SELECT start_time,end_time INTO opening,closing FROM public.availability WHERE user_id=b.user_id AND day=extract(dow FROM local_day)::integer AND enabled;
 IF opening IS NULL OR new_start<now()+interval '2 hours' OR local_day>(now() AT TIME ZONE p.timezone)::date+90 OR new_start<((local_day+opening) AT TIME ZONE p.timezone) OR new_start+make_interval(mins=>minutes)>((local_day+closing) AT TIME ZONE p.timezone) OR mod(extract(epoch FROM new_start-((local_day+opening) AT TIME ZONE p.timezone))::integer,900)<>0 THEN RAISE EXCEPTION 'slot_unavailable';END IF;
 IF EXISTS(SELECT 1 FROM public.bookings x WHERE x.user_id=b.user_id AND x.id<>b.id AND x.status='confirmed' AND tstzrange(new_start,new_start+make_interval(mins=>minutes+e.buffer),'[)')&&tstzrange(x.starts_at,x.blocked_until,'[)')) THEN RAISE EXCEPTION 'slot_unavailable';END IF;
 UPDATE public.bookings SET starts_at=new_start,ends_at=new_start+make_interval(mins=>minutes),blocked_until=new_start+make_interval(mins=>minutes+e.buffer) WHERE id=b.id RETURNING * INTO b;
 RETURN jsonb_build_object('id',b.id,'starts_at',b.starts_at,'ends_at',b.ends_at);
END;$$;
