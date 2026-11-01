begin;
create table private.daily_room_usage(
 room_name text primary key,
 booking_id uuid not null references public.bookings(id) on delete restrict,
 user_id uuid not null references public."user"(id) on delete restrict,
 usage_id uuid references private.provider_usage_reservations(id),
 starts_at timestamptz not null,
 expires_at timestamptz not null,
 rate_micros bigint check(rate_micros>0),
 last_meeting_ended_at timestamptz,
 created_at timestamptz not null default now()
);
insert into private.daily_room_usage(room_name,booking_id,user_id,usage_id,starts_at,expires_at)
select room_name,booking_id,user_id,usage_id,starts_at,expires_at from private.video_rooms;
create index daily_room_usage_owner_idx on private.daily_room_usage(user_id,created_at,room_name);
create table private.daily_participant_usage(
 room_name text not null references private.daily_room_usage(room_name) on delete restrict,
 session_id text not null check(length(session_id) between 1 and 128),
 joined_at timestamptz not null,
 duration_ms bigint not null check(duration_ms between 0 and 86400000),
 anomaly boolean not null default false,
 received_at timestamptz not null default now(),
 primary key(room_name,session_id)
);
create index daily_participant_usage_time_idx on private.daily_participant_usage(joined_at,room_name);
create table private.daily_webhook_receipts(
 event_id text primary key check(length(event_id) between 1 and 200),
 room_name text not null references private.daily_room_usage(room_name) on delete restrict,
 kind text not null check(kind in ('participant.left','meeting.ended')),
 payload_hash text not null,
 received_at timestamptz not null default now()
);
revoke all on private.daily_room_usage,private.daily_participant_usage,private.daily_webhook_receipts from public,anon,authenticated;
commit;
