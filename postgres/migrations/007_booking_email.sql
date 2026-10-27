CREATE TABLE private.email_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,recipient text NOT NULL,subject text NOT NULL,message text NOT NULL,attempts integer NOT NULL DEFAULT 0,sent_at timestamptz,last_attempt_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON private.email_outbox FROM public,anon,authenticated;
CREATE FUNCTION private.queue_booking_email() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE event_title text; host_email text; subject_line text; message_text text;
BEGIN
 IF TG_OP='UPDATE' AND OLD.status=NEW.status THEN RETURN NEW; END IF;
 SELECT e.title,u.email INTO event_title,host_email FROM public.event_types e JOIN public."user" u ON u.id=e.user_id WHERE e.id=NEW.event_id;
 subject_line:=CASE WHEN NEW.status='cancelled' THEN 'Appointment cancelled: ' ELSE 'Appointment confirmed: ' END || event_title;
 message_text:=subject_line||E'\n\nStarts: '||to_char(NEW.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI')||E' UTC\nEnds: '||to_char(NEW.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI')||E' UTC\n\nOpen your Zenvio booking or workspace for appointment details.';
 INSERT INTO private.email_outbox(booking_id,recipient,subject,message) VALUES(NEW.id,NEW.guest_email,subject_line,message_text),(NEW.id,host_email,subject_line,message_text);
 RETURN NEW;
END;$$;
CREATE TRIGGER booking_email AFTER INSERT OR UPDATE OF status ON public.bookings FOR EACH ROW EXECUTE FUNCTION private.queue_booking_email();
