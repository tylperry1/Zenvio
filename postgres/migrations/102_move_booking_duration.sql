-- Allow host edits to pass an explicit duration so move_booking can validate the
-- destination window without first extending the booking at its current start
-- (non-deferrable exclusion would reject that intermediate write).
DROP FUNCTION IF EXISTS private.move_booking(uuid, timestamptz, uuid, uuid);

CREATE FUNCTION private.move_booking(
  target uuid,
  new_start timestamptz,
  actor uuid,
  guest_token uuid,
  duration_minutes integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  b public.bookings;
  e public.event_types;
  p public.profiles;
  opening time;
  closing time;
  local_day date;
  minutes integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(user_id::text, 0))
    FROM public.bookings WHERE id = target;
  SELECT * INTO b FROM public.bookings WHERE id = target FOR UPDATE;
  IF NOT FOUND OR NOT (actor = b.user_id OR (actor IS NULL AND guest_token = b.cancel_token)) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(b.user_id::text, 0));
  SELECT * INTO e FROM public.event_types WHERE id = b.event_id FOR SHARE;
  SELECT * INTO p FROM public.profiles WHERE id = b.user_id;
  IF b.status <> 'confirmed' OR b.starts_at <= now() OR NOT e.active OR e.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF actor IS NULL AND b.starts_at < now() + make_interval(mins => e.reschedule_notice_minutes) THEN
    RAISE EXCEPTION 'reschedule_policy';
  END IF;
  minutes := COALESCE(
    duration_minutes,
    (extract(epoch FROM b.ends_at - b.starts_at) / 60)::integer
  );
  IF minutes < 5 OR minutes > 24 * 60 THEN
    RAISE EXCEPTION 'slot_unavailable';
  END IF;
  local_day := (new_start AT TIME ZONE p.timezone)::date;
  SELECT start_time, end_time INTO opening, closing
    FROM public.availability
   WHERE user_id = b.user_id
     AND day = extract(dow FROM local_day)::integer
     AND enabled;
  IF opening IS NULL
     OR new_start < now() + interval '2 hours'
     OR local_day > (now() AT TIME ZONE p.timezone)::date + 90
     OR new_start < ((local_day + opening) AT TIME ZONE p.timezone)
     OR new_start + make_interval(mins => minutes) > ((local_day + closing) AT TIME ZONE p.timezone)
     OR mod(extract(epoch FROM new_start - ((local_day + opening) AT TIME ZONE p.timezone))::integer, 900) <> 0
  THEN
    RAISE EXCEPTION 'slot_unavailable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.bookings x
     WHERE x.user_id = b.user_id
       AND x.id <> b.id
       AND x.status = 'confirmed'
       AND tstzrange(new_start, new_start + make_interval(mins => minutes + e.buffer), '[)')
         && tstzrange(x.starts_at, x.blocked_until, '[)')
  ) THEN
    RAISE EXCEPTION 'slot_unavailable';
  END IF;
  UPDATE public.bookings
     SET starts_at = new_start,
         ends_at = new_start + make_interval(mins => minutes),
         blocked_until = new_start + make_interval(mins => minutes + e.buffer)
   WHERE id = b.id
   RETURNING * INTO b;
  RETURN jsonb_build_object('id', b.id, 'starts_at', b.starts_at, 'ends_at', b.ends_at);
END;
$$;

REVOKE ALL ON FUNCTION private.move_booking(uuid, timestamptz, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
