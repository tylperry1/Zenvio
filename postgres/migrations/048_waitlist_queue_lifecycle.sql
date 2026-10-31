begin;
-- Pending cancellation events are operational queue rows, not customer/financial evidence.
-- They must not prevent deletion of an otherwise empty account. Actual offers and opted-in
-- waitlists retain their restrictive references and the account deletion blockers.
alter table private.waitlist_slot_events drop constraint waitlist_slot_events_user_id_fkey;
alter table private.waitlist_slot_events add constraint waitlist_slot_events_user_id_fkey foreign key(user_id) references public."user"(id) on delete cascade;
alter table private.waitlist_slot_events drop constraint waitlist_slot_events_booking_id_fkey;
alter table private.waitlist_slot_events add constraint waitlist_slot_events_booking_id_fkey foreign key(booking_id) references public.bookings(id) on delete cascade;
alter table private.waitlist_slot_events drop constraint waitlist_slot_events_event_id_fkey;
alter table private.waitlist_slot_events add constraint waitlist_slot_events_event_id_fkey foreign key(event_id) references public.event_types(id) on delete cascade;
commit;
