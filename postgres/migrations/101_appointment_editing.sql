-- Appointment field editing: Google + Microsoft sync on location changes,
-- notification history helper index. Host edits run through the service pool
-- (same pattern as move_booking), not RLS.
-- Numbered 101: main already shipped 098–100 (business address + messaging).

BEGIN;

-- Queue Google Calendar updates when public location snapshot fields change.
CREATE OR REPLACE FUNCTION private.queue_google_location() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (
    NEW.location IS DISTINCT FROM OLD.location
    OR NEW.location_mode IS DISTINCT FROM OLD.location_mode
    OR NEW.service_address IS DISTINCT FROM OLD.service_address
    OR NEW.access_instructions IS DISTINCT FROM OLD.access_instructions
  ) AND EXISTS (
    SELECT 1 FROM private.google_calendar_connections c
     WHERE c.user_id = NEW.user_id AND c.sync_events
  ) THEN
    INSERT INTO private.google_calendar_jobs(booking_id, user_id)
    VALUES (NEW.id, NEW.user_id)
    ON CONFLICT (booking_id) DO UPDATE
      SET attempts = 0,
          not_before = now(),
          last_error = NULL,
          revision = private.google_calendar_jobs.revision + 1,
          updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS google_booking_location ON public.bookings;
CREATE TRIGGER google_booking_location
  AFTER UPDATE OF location, location_mode, service_address, access_instructions
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION private.queue_google_location();

-- Mirror the same location fields for Outlook / Microsoft Calendar jobs.
CREATE OR REPLACE FUNCTION private.queue_microsoft_location() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (
    NEW.location IS DISTINCT FROM OLD.location
    OR NEW.location_mode IS DISTINCT FROM OLD.location_mode
    OR NEW.service_address IS DISTINCT FROM OLD.service_address
    OR NEW.access_instructions IS DISTINCT FROM OLD.access_instructions
  ) AND EXISTS (
    SELECT 1 FROM private.microsoft_calendar_connections c
     WHERE c.user_id = NEW.user_id AND c.sync_events
  ) THEN
    INSERT INTO private.microsoft_calendar_jobs(booking_id, user_id)
    VALUES (NEW.id, NEW.user_id)
    ON CONFLICT (booking_id) DO UPDATE
      SET attempts = 0,
          not_before = now(),
          last_error = NULL,
          revision = private.microsoft_calendar_jobs.revision + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS microsoft_booking_location ON public.bookings;
CREATE TRIGGER microsoft_booking_location
  AFTER UPDATE OF location, location_mode, service_address, access_instructions
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION private.queue_microsoft_location();

-- Faster host-facing notification history for a single appointment.
CREATE INDEX IF NOT EXISTS notifications_booking_created_idx
  ON private.notifications (booking_id, created_at DESC)
  WHERE booking_id IS NOT NULL;

COMMENT ON FUNCTION private.queue_google_location() IS
  'Upsert a Google Calendar sync job when appointment location fields change.';
COMMENT ON FUNCTION private.queue_microsoft_location() IS
  'Upsert a Microsoft Calendar sync job when appointment location fields change.';

COMMIT;
