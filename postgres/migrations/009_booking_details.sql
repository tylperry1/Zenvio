ALTER TABLE public.bookings ADD COLUMN guest_phone text NOT NULL DEFAULT '' CHECK(length(guest_phone)<=40), ADD COLUMN guest_company text NOT NULL DEFAULT '' CHECK(length(guest_company)<=100), ADD COLUMN meeting_purpose text NOT NULL DEFAULT '' CHECK(length(meeting_purpose)<=500);
CREATE FUNCTION public.reserve_booking_details(host_slug text,event_slug text,slot_start timestamptz,visitor_name text,visitor_email text,visitor_notes text,visitor_phone text,visitor_company text,visitor_purpose text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF visitor_phone IS NULL OR visitor_company IS NULL OR visitor_purpose IS NULL OR length(visitor_phone)>40 OR length(visitor_company)>100 OR length(visitor_purpose)>500 THEN RAISE EXCEPTION 'invalid_details'; END IF;
 result:=public.reserve_booking(host_slug,event_slug,slot_start,visitor_name,visitor_email,visitor_notes);
 UPDATE public.bookings SET guest_phone=visitor_phone,guest_company=visitor_company,meeting_purpose=visitor_purpose WHERE id=(result->>'id')::uuid;
 UPDATE public.contacts SET company=visitor_company WHERE user_id=(SELECT user_id FROM public.bookings WHERE id=(result->>'id')::uuid) AND email=lower(trim(visitor_email)) AND company='' AND visitor_company<>'';
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.reserve_booking_details(text,text,timestamptz,text,text,text,text,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.reserve_booking_details(text,text,timestamptz,text,text,text,text,text,text) TO anon,authenticated;
