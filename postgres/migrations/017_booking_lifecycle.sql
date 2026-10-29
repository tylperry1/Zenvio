ALTER TABLE public.event_types ADD COLUMN reminder_minutes integer[] NOT NULL DEFAULT ARRAY[1440,60], ADD COLUMN cancellation_notice_minutes integer NOT NULL DEFAULT 0 CHECK(cancellation_notice_minutes BETWEEN 0 AND 10080), ADD COLUMN reschedule_notice_minutes integer NOT NULL DEFAULT 0 CHECK(reschedule_notice_minutes BETWEEN 0 AND 10080), ADD COLUMN intake_questions jsonb NOT NULL DEFAULT '[]';
ALTER TABLE public.bookings ADD COLUMN revision integer NOT NULL DEFAULT 0, ADD COLUMN intake_snapshot jsonb NOT NULL DEFAULT '[]', ADD COLUMN contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;
UPDATE public.bookings b SET contact_id=c.id FROM public.contacts c WHERE c.user_id=b.user_id AND c.email=b.guest_email;
CREATE TABLE private.booking_activity(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,actor_id uuid,action text NOT NULL,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE private.delivery_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
 booking_id uuid REFERENCES public.bookings(id) ON DELETE CASCADE,envelope_id uuid REFERENCES private.signature_envelopes(id),document_id uuid REFERENCES private.signing_documents(id),recipient_id uuid REFERENCES private.signature_recipients(id),
 kind text NOT NULL,dedupe_key text NOT NULL UNIQUE,booking_revision integer,recipient text NOT NULL,subject text NOT NULL,
 payload_ciphertext text,run_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '15 days',
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sent','failed','cancelled','uncertain')),attempts integer NOT NULL DEFAULT 0,
 provider_id text,provider_status text,last_error text,claimed_at timestamptz,sent_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delivery_jobs_due ON private.delivery_jobs(run_at) WHERE status='queued';
CREATE INDEX delivery_jobs_owner ON private.delivery_jobs(user_id,created_at DESC);
REVOKE ALL ON private.booking_activity,private.delivery_jobs FROM public,anon,authenticated;
CREATE FUNCTION private.lifecycle_booking() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.starts_at,NEW.ends_at,NEW.status) IS DISTINCT FROM (OLD.starts_at,OLD.ends_at,OLD.status) THEN
 NEW.revision:=OLD.revision+1;
 INSERT INTO private.booking_activity(booking_id,action,details) VALUES(OLD.id,CASE WHEN NEW.status='cancelled' THEN 'cancelled' ELSE 'rescheduled' END,jsonb_build_object('previousStart',OLD.starts_at,'newStart',NEW.starts_at));
 UPDATE private.delivery_jobs SET status='cancelled',payload_ciphertext=NULL WHERE booking_id=OLD.id AND status='queued';
 END IF;RETURN NEW;
END;$$;
CREATE TRIGGER booking_lifecycle BEFORE UPDATE OF starts_at,ends_at,status ON public.bookings FOR EACH ROW EXECUTE FUNCTION private.lifecycle_booking();
-- Time changes need the same Google update queue used by cancellations.
CREATE FUNCTION private.queue_google_move() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF (NEW.starts_at,NEW.ends_at) IS DISTINCT FROM (OLD.starts_at,OLD.ends_at) AND EXISTS(SELECT 1 FROM private.google_calendar_connections c WHERE c.user_id=NEW.user_id AND c.sync_events) THEN
 INSERT INTO private.google_calendar_jobs(booking_id,user_id) VALUES(NEW.id,NEW.user_id) ON CONFLICT(booking_id) DO UPDATE SET attempts=0,not_before=now(),last_error=NULL,revision=private.google_calendar_jobs.revision+1;END IF;RETURN NEW;END;$$;
CREATE TRIGGER google_booking_move AFTER UPDATE OF starts_at,ends_at ON public.bookings FOR EACH ROW EXECUTE FUNCTION private.queue_google_move();
CREATE FUNCTION private.move_booking(target uuid,new_start timestamptz,actor uuid,guest_token uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE b public.bookings; e public.event_types; p public.profiles; opening time; closing time; local_day date; minutes integer;
BEGIN
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
REVOKE ALL ON FUNCTION private.move_booking(uuid,timestamptz,uuid,uuid) FROM public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.cancel_booking(cancellation_token uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.bookings b SET status='cancelled' FROM public.event_types e WHERE b.event_id=e.id AND b.cancel_token=$1 AND b.status='confirmed' AND b.starts_at>now()+make_interval(mins=>e.cancellation_notice_minutes);
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found';END IF;END;$$;
