begin;
ALTER TABLE private.sms_outbox ADD COLUMN booking_id uuid REFERENCES public.bookings(id) ON DELETE RESTRICT;
ALTER TABLE private.sms_outbox ADD COLUMN booking_revision integer;
ALTER TABLE private.sms_outbox ADD CONSTRAINT sms_booking_source_pair CHECK ((booking_id IS NULL) = (booking_revision IS NULL));
CREATE INDEX sms_outbox_booking_idx ON private.sms_outbox(booking_id,booking_revision) WHERE booking_id IS NOT NULL;
commit;
