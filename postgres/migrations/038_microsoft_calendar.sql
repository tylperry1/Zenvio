begin;

create table private.microsoft_calendar_oauth(
  user_id uuid primary key references public."user"(id) on delete cascade,
  state_hash text not null,verifier_ciphertext text not null,redirect_uri text not null,
  expires_at timestamptz not null default now()+interval '10 minutes'
);
create table private.microsoft_calendar_connections(
  user_id uuid not null references public."user"(id) on delete cascade,
  account_id text not null,account_email text not null,tenant_id text,
  access_ciphertext text not null,refresh_ciphertext text not null,
  expires_at timestamptz not null,scope text not null,
  status text not null default 'connected' check(status in ('connected','reconnect_required')),
  check_conflicts boolean not null default true,sync_events boolean not null default true,
  selected_calendar_id text not null default 'primary',delta_link_ciphertext text,
  last_sync_at timestamptz,last_error text,created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),primary key(user_id,account_id)
);
create table private.microsoft_calendar_events(
  user_id uuid not null,account_id text not null,booking_id uuid not null references public.bookings(id) on delete cascade,
  event_id text not null,status text not null,synced_at timestamptz not null default now(),
  primary key(user_id,account_id,booking_id),
  foreign key(user_id,account_id) references private.microsoft_calendar_connections(user_id,account_id) on delete cascade
);
create table private.microsoft_calendar_jobs(
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  user_id uuid not null references public."user"(id) on delete cascade,
  attempts integer not null default 0,not_before timestamptz not null default now(),
  locked_until timestamptz,claim_token uuid,last_error text,revision integer not null default 0
);
create table private.microsoft_calendar_subscriptions(
  user_id uuid not null,account_id text not null,subscription_id text not null unique,
  client_state_hash text not null,resource text not null,expires_at timestamptz not null,
  last_notification_at timestamptz,updated_at timestamptz not null default now(),
  primary key(user_id,account_id),
  foreign key(user_id,account_id) references private.microsoft_calendar_connections(user_id,account_id) on delete cascade
);

create or replace function private.queue_microsoft_booking() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.microsoft_calendar_connections c where c.user_id=new.user_id and c.sync_events) then
  insert into private.microsoft_calendar_jobs(booking_id,user_id) values(new.id,new.user_id)
  on conflict(booking_id) do update set attempts=0,not_before=now(),last_error=null,
    revision=private.microsoft_calendar_jobs.revision+1;
 end if;return new;
end;$$;
create trigger microsoft_booking_insert after insert on public.bookings
 for each row execute function private.queue_microsoft_booking();
create trigger microsoft_booking_change after update of starts_at,ends_at,status on public.bookings
 for each row execute function private.queue_microsoft_booking();

revoke all on private.microsoft_calendar_oauth,private.microsoft_calendar_connections,
 private.microsoft_calendar_events,private.microsoft_calendar_jobs,
 private.microsoft_calendar_subscriptions from public,anon,authenticated;
commit;
