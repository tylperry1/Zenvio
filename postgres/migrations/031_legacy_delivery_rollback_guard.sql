-- A previous application release must not resend messages already bridged into
-- the durable queue if the application is rolled back while this schema remains.
CREATE FUNCTION private.guard_migrated_booking_mail() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.migrated_at IS NOT NULL THEN NEW.attempts:=greatest(NEW.attempts,5);END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION private.guard_migrated_booking_mail() FROM public,anon,authenticated;
CREATE TRIGGER guard_migrated_booking_mail BEFORE UPDATE OF migrated_at ON private.email_outbox FOR EACH ROW EXECUTE FUNCTION private.guard_migrated_booking_mail();
UPDATE private.email_outbox SET attempts=greatest(attempts,5) WHERE migrated_at IS NOT NULL;
