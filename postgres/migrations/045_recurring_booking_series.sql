begin;
create table private.booking_series(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public."user"(id) on delete restrict,
 event_id uuid not null references public.event_types(id) on delete restrict,
 reference text not null,digest text not null,timezone text not null,recurrence text not null,
 starts_at jsonb not null,booking_ids uuid[] not null default '{}',created_at timestamptz not null default now(),
 unique(user_id,reference)
);
revoke all on private.booking_series from public,anon,authenticated;
commit;
