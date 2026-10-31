begin;
alter table public.bookings add column booking_kind text not null default 'appointment' check(booking_kind in ('appointment','class'));
create table private.class_sessions(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public."user"(id) on delete restrict,
 event_id uuid not null references public.event_types(id) on delete restrict,
 anchor_booking_id uuid not null unique references public.bookings(id) on delete restrict,
 title text not null,description text not null default '',capacity integer not null check(capacity between 1 and 500),
 published boolean not null default false,state text not null default 'scheduled' check(state in ('scheduled','cancelled','completed')),
 starts_at timestamptz not null,ends_at timestamptz not null,cancellation_notice_minutes integer not null default 0,
 credit_cost integer not null default 0 check(credit_cost between 0 and 1000000),credit_unit text not null default 'SERVICE',
 created_at timestamptz not null default now(),check(ends_at>starts_at)
);
create index class_sessions_owner_idx on private.class_sessions(user_id,starts_at);
create table private.class_registrations(
 id uuid primary key default gen_random_uuid(),session_id uuid not null references private.class_sessions(id) on delete restrict,
 user_id uuid not null references public."user"(id) on delete restrict,contact_id uuid not null references public.contacts(id) on delete restrict,
 name text not null,email text not null,reference text not null,digest text not null,
 cancel_token_hash text not null unique,cancel_token_ciphertext text not null,
 state text not null default 'confirmed' check(state in ('confirmed','cancelled')),
 balance_account_id uuid references private.customer_balance_accounts(id) on delete restrict,
 debit_entry_id uuid references private.customer_balance_entries(id) on delete restrict,
 created_at timestamptz not null default now(),cancelled_at timestamptz,
 unique(session_id,reference)
);
create unique index class_registration_guest_idx on private.class_registrations(session_id,lower(email)) where state='confirmed';
create index class_registration_owner_idx on private.class_registrations(user_id,created_at);
revoke all on private.class_sessions,private.class_registrations from public,anon,authenticated;
commit;
