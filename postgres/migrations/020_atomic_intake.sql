CREATE FUNCTION public.reserve_booking_intake(host_slug text,event_slug text,slot_start timestamptz,visitor_name text,visitor_email text,visitor_notes text,visitor_phone text,visitor_company text,visitor_purpose text,answers_snapshot jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; schema_questions jsonb; actual_schema jsonb;
BEGIN
 SELECT e.intake_questions INTO schema_questions FROM public.event_types e JOIN public.profiles p ON p.id=e.user_id WHERE p.slug=$1 AND e.slug=$2 AND e.active AND e.deleted_at IS NULL FOR SHARE OF e;
 SELECT coalesce(jsonb_agg(x.value-'answer'),'[]'::jsonb) INTO actual_schema FROM jsonb_array_elements(answers_snapshot) x;
 IF schema_questions IS DISTINCT FROM actual_schema THEN RAISE EXCEPTION 'invalid_booking_form_changed';END IF;
 result:=public.reserve_booking_details($1,$2,$3,$4,$5,$6,$7,$8,$9);
 UPDATE public.bookings b SET intake_snapshot=answers_snapshot,contact_id=(SELECT c.id FROM public.contacts c WHERE c.user_id=b.user_id AND c.email=b.guest_email) WHERE b.id=(result->>'id')::uuid;
 RETURN result;END;$$;
REVOKE ALL ON FUNCTION public.reserve_booking_intake(text,text,timestamptz,text,text,text,text,text,text,jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.reserve_booking_intake(text,text,timestamptz,text,text,text,text,text,text,jsonb) TO anon,authenticated;
CREATE OR REPLACE FUNCTION private.queue_booking_email() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE event_title text; host_email text; subject_line text; message_text text; base_url text;
BEGIN
 IF TG_OP='UPDATE' AND OLD.status=NEW.status THEN RETURN NEW;END IF;
 SELECT e.title,u.email INTO event_title,host_email FROM public.event_types e JOIN public."user" u ON u.id=e.user_id WHERE e.id=NEW.event_id;
 subject_line:=CASE WHEN NEW.status='cancelled' THEN 'Appointment cancelled: ' ELSE 'Appointment confirmed: ' END||event_title;
 message_text:=subject_line||E'\n\nStarts: '||to_char(NEW.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI')||E' UTC\nEnds: '||to_char(NEW.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI')||E' UTC\n\nManage or reschedule your appointment: https://gozenvio.com/reschedule#token='||NEW.cancel_token::text;
 INSERT INTO private.email_outbox(booking_id,recipient,subject,message) VALUES(NEW.id,NEW.guest_email,subject_line,message_text),(NEW.id,host_email,subject_line,message_text);RETURN NEW;END;$$;
