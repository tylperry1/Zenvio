begin;
create table private.class_cleanup_jobs(
 session_id uuid primary key references private.class_sessions(id) on delete restrict,
 user_id uuid not null references public."user"(id) on delete restrict,
 attempts integer not null default 0,completed_at timestamptz,last_error text,created_at timestamptz not null default now()
);
create function private.queue_class_cancellation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='confirmed' and new.status='cancelled' and new.booking_kind='class' then
  insert into private.class_cleanup_jobs(session_id,user_id) select id,user_id from private.class_sessions where anchor_booking_id=new.id on conflict(session_id) do update set completed_at=null,attempts=0;
 end if;return new;
end $$;
create trigger class_cancellation_cleanup after update of status on public.bookings for each row execute function private.queue_class_cancellation();
create or replace function private.capture_waitlist_slot() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='confirmed' and new.status='cancelled' and new.booking_kind<>'class' and old.starts_at>now()+interval '2 hours' then
  insert into private.waitlist_slot_events(booking_id,revision,user_id,event_id,starts_at) values(new.id,new.revision,new.user_id,new.event_id,old.starts_at) on conflict do nothing;
 end if;return new;
end $$;
revoke all on private.class_cleanup_jobs from public,anon,authenticated;
revoke all on function private.queue_class_cancellation() from public,anon,authenticated;
commit;
