CREATE TABLE private.google_calendar_connections(user_id uuid PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,account_sub text NOT NULL,account_email text NOT NULL,access_ciphertext text NOT NULL,refresh_ciphertext text NOT NULL,expires_at timestamptz NOT NULL,scope text NOT NULL,status text NOT NULL DEFAULT 'connected' CHECK(status IN ('connected','reconnect_required')),check_conflicts boolean NOT NULL DEFAULT true,sync_events boolean NOT NULL DEFAULT true,last_sync_at timestamptz,last_error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE private.google_calendar_oauth(user_id uuid PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,state_hash text UNIQUE NOT NULL,verifier_ciphertext text NOT NULL,redirect_uri text NOT NULL,expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes');
CREATE TABLE private.google_calendar_events(user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,account_sub text NOT NULL,booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,event_id text NOT NULL,status text NOT NULL,synced_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,account_sub,booking_id));
CREATE TABLE private.google_calendar_jobs(booking_id uuid PRIMARY KEY REFERENCES public.bookings(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,attempts integer NOT NULL DEFAULT 0,not_before timestamptz NOT NULL DEFAULT now(),last_error text,updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX google_jobs_ready ON private.google_calendar_jobs(not_before);
REVOKE ALL ON private.google_calendar_connections,private.google_calendar_oauth,private.google_calendar_events,private.google_calendar_jobs FROM public,anon,authenticated;
CREATE FUNCTION private.queue_google_booking() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.status=NEW.status THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM private.google_calendar_connections c WHERE c.user_id=NEW.user_id AND c.sync_events) THEN
 INSERT INTO private.google_calendar_jobs(booking_id,user_id) VALUES(NEW.id,NEW.user_id) ON CONFLICT(booking_id) DO UPDATE SET attempts=0,not_before=now(),last_error=NULL,updated_at=now();
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER google_booking_change AFTER INSERT OR UPDATE OF status ON public.bookings FOR EACH ROW EXECUTE FUNCTION private.queue_google_booking();
ALTER TABLE private.google_calendar_jobs ADD COLUMN locked_until timestamptz,ADD COLUMN claim_token uuid,ADD COLUMN revision integer NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION private.queue_google_booking() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.status=NEW.status THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM private.google_calendar_connections c WHERE c.user_id=NEW.user_id AND c.sync_events) THEN
 INSERT INTO private.google_calendar_jobs(booking_id,user_id) VALUES(NEW.id,NEW.user_id) ON CONFLICT(booking_id) DO UPDATE SET attempts=0,not_before=now(),last_error=NULL,revision=private.google_calendar_jobs.revision+1,updated_at=now();
 END IF;
 RETURN NEW;
END;$$;
