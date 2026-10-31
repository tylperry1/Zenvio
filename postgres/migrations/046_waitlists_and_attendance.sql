begin;
alter table public.bookings add column attendance_status text not null default 'unknown' check(attendance_status in ('unknown','attended','no_show'));
alter table public.event_types add column no_show_policy text not null default '' check(length(no_show_policy)<=2000);
create table private.appointment_waitlists(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public."user"(id) on delete restrict,
 event_id uuid not null references public.event_types(id) on delete restrict,
 contact_id uuid not null references public.contacts(id) on delete restrict,
 preferred_from timestamptz not null,preferred_until timestamptz not null,
 email_opt_in boolean not null default false,consent_evidence text not null,
 state text not null default 'waiting' check(state in ('waiting','offered','cancelled','booked')),
 created_at timestamptz not null default now(),check(preferred_until>preferred_from)
);
create unique index appointment_waitlists_active_idx on private.appointment_waitlists(user_id,event_id,contact_id) where state in ('waiting','offered');
create index appointment_waitlists_match_idx on private.appointment_waitlists(event_id,created_at) where state='waiting' and email_opt_in;
create table private.waitlist_slot_events(
 id uuid primary key default gen_random_uuid(),booking_id uuid not null references public.bookings(id) on delete restrict,
 revision integer not null,user_id uuid not null references public."user"(id) on delete restrict,event_id uuid not null references public.event_types(id) on delete restrict,
 starts_at timestamptz not null,processed_at timestamptz,created_at timestamptz not null default now(),unique(booking_id,revision)
);
create table private.waitlist_offers(
 id uuid primary key default gen_random_uuid(),waitlist_id uuid not null references private.appointment_waitlists(id) on delete restrict,
 slot_event_id uuid not null unique references private.waitlist_slot_events(id) on delete restrict,
 token_hash text not null unique,state text not null default 'offered' check(state in ('offered','expired','cancelled','booked')),
 booking_id uuid references public.bookings(id) on delete restrict,expires_at timestamptz not null,created_at timestamptz not null default now()
);
alter table private.delivery_jobs add column waitlist_offer_id uuid references private.waitlist_offers(id) on delete restrict;
create function private.capture_waitlist_slot() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='confirmed' and new.status='cancelled' and old.starts_at>now()+interval '2 hours' then
  insert into private.waitlist_slot_events(booking_id,revision,user_id,event_id,starts_at) values(new.id,new.revision,new.user_id,new.event_id,old.starts_at) on conflict do nothing;
 end if;return new;
end $$;
create trigger capture_waitlist_cancellation after update of status on public.bookings for each row execute function private.capture_waitlist_slot();
revoke all on function private.capture_waitlist_slot() from public,anon,authenticated;
revoke all on private.appointment_waitlists,private.waitlist_slot_events,private.waitlist_offers from public,anon,authenticated;
commit;
