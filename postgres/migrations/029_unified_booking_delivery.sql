ALTER TABLE private.email_outbox ADD COLUMN migrated_at timestamptz,ADD COLUMN booking_revision integer NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION private.lifecycle_booking() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.starts_at,NEW.ends_at,NEW.status) IS DISTINCT FROM (OLD.starts_at,OLD.ends_at,OLD.status) THEN
 NEW.revision:=OLD.revision+1;
 INSERT INTO private.booking_activity(booking_id,action,details) VALUES(OLD.id,CASE WHEN NEW.status='cancelled' THEN 'cancelled' ELSE 'rescheduled' END,jsonb_build_object('previousStart',OLD.starts_at,'newStart',NEW.starts_at));
 UPDATE private.email_outbox SET migrated_at=now(),message='' WHERE booking_id=OLD.id AND sent_at IS NULL AND migrated_at IS NULL;
 UPDATE private.delivery_jobs SET status='cancelled',payload_ciphertext=NULL WHERE booking_id=OLD.id AND status='queued';
 END IF;RETURN NEW;
END;$$;

CREATE OR REPLACE FUNCTION private.queue_booking_email() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE event_title text; host_email text; subject_line text; message_text text; base_url text;
BEGIN
 IF TG_OP='UPDATE' AND OLD.status=NEW.status THEN RETURN NEW;END IF;
 SELECT e.title,u.email INTO event_title,host_email FROM public.event_types e JOIN public."user" u ON u.id=e.user_id WHERE e.id=NEW.event_id;
 subject_line:=CASE WHEN NEW.status='cancelled' THEN 'Appointment cancelled: ' ELSE 'Appointment confirmed: ' END||event_title;
 message_text:=subject_line||E'\n\nStarts: '||to_char(NEW.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI')||E' UTC\nEnds: '||to_char(NEW.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI')||E' UTC\n\nManage or reschedule your appointment: https://gozenvio.com/reschedule#token='||NEW.cancel_token::text;
 INSERT INTO private.email_outbox(booking_id,recipient,subject,message,booking_revision) VALUES(NEW.id,NEW.guest_email,subject_line,message_text,NEW.revision),(NEW.id,host_email,subject_line,message_text,NEW.revision);RETURN NEW;END;$$;
