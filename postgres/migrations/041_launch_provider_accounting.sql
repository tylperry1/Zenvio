begin;
-- Additive only. Historical Twilio and provider event records remain intact.
alter table private.message_records drop constraint message_records_provider_check;
alter table private.message_records add constraint message_records_provider_check check(provider in ('resend','twilio','telnyx'));
alter table private.sms_provider_connections drop constraint sms_provider_connections_provider_check;
alter table private.sms_provider_connections add constraint sms_provider_connections_provider_check check(provider in ('twilio','telnyx'));
alter table private.sms_provider_connections add column messaging_profile_id text;
alter table private.sms_provider_connections add column registration_verified_at timestamptz;
alter table private.sms_provider_connections add column registration_reference text;
alter table private.provider_webhook_events drop constraint provider_webhook_events_provider_check;
alter table private.provider_webhook_events add constraint provider_webhook_events_provider_check check(provider in ('twilio','resend','google','microsoft','stripe','telnyx','daily'));
-- Correct the historical double-escaped E.164 regex without rewriting its migration.
alter table private.contact_consents drop constraint contact_consents_phone_e164_check;
alter table private.contact_consents add constraint contact_consents_phone_e164_check check(phone_e164 ~ '^\+[1-9][0-9]{7,14}$');
alter table private.sms_provider_connections drop constraint sms_provider_connections_sender_number_check;
alter table private.sms_provider_connections add constraint sms_provider_connections_sender_number_check check(sender_number ~ '^\+[1-9][0-9]{7,14}$');
alter table private.message_records add column provider_event_at timestamptz;
alter table private.message_records add column uncertain_at timestamptz;

create table private.provider_usage_reservations(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public."user"(id) on delete restrict,
 provider text not null,
 model text,
 state text not null default 'reserved' check(state in ('reserved','settled','uncertain','released')),
 reserved_micros bigint not null check(reserved_micros>=0),
 actual_micros bigint check(actual_micros>=0),
 input_tokens bigint not null default 0 check(input_tokens>=0),
 output_tokens bigint not null default 0 check(output_tokens>=0),
 units numeric(18,6) check(units>=0),
 currency text not null default 'USD' check(currency='USD'),
 created_at timestamptz not null default now(),settled_at timestamptz
);
create index provider_usage_month_idx on private.provider_usage_reservations(provider,created_at,user_id);

create table private.sms_outbox(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public."user"(id) on delete restrict,
 reference text not null, to_number text not null, ciphertext text not null,
 body_digest text not null,
 state text not null default 'queued' check(state in ('queued','sending','accepted','delivered','failed','suppressed','uncertain')),
 provider text not null check(provider in ('telnyx','twilio')),
 provider_message_id text,
 usage_id uuid references private.provider_usage_reservations(id),
 last_error text,created_at timestamptz not null default now(),claimed_at timestamptz,finished_at timestamptz,
 unique(user_id,reference),unique(provider,provider_message_id)
);
create index sms_outbox_pending_idx on private.sms_outbox(created_at) where state='queued';

create table private.video_rooms(
 booking_id uuid primary key references public.bookings(id) on delete restrict,
 user_id uuid not null references public."user"(id) on delete restrict,
 usage_id uuid references private.provider_usage_reservations(id),
 provider text not null default 'daily' check(provider='daily'),
 room_name text not null unique,join_url text not null,
 starts_at timestamptz not null,expires_at timestamptz not null,
 created_at timestamptz not null default now(),check(expires_at>starts_at)
);
create index video_rooms_owner_idx on private.video_rooms(user_id,expires_at);

create table private.customer_balance_accounts(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public."user"(id) on delete restrict,
 contact_id uuid not null references public.contacts(id) on delete restrict,
 kind text not null check(kind in ('package','gift_card','loyalty')),
 unit text not null check(unit ~ '^[A-Z_]{2,24}$'),
 balance bigint not null default 0 check(balance>=0),
 expires_at timestamptz,created_at timestamptz not null default now(),
 unique(user_id,contact_id,kind,unit)
);
create table private.customer_balance_entries(
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references private.customer_balance_accounts(id) on delete restrict,
 user_id uuid not null references public."user"(id) on delete restrict,
 delta bigint not null check(delta<>0),balance_after bigint not null check(balance_after>=0),
 reference text not null,reason text not null,
 reversal_of uuid unique references private.customer_balance_entries(id),
 created_at timestamptz not null default now(),unique(user_id,reference)
);
create index customer_balance_owner_idx on private.customer_balance_accounts(user_id,created_at);
create index customer_balance_entry_idx on private.customer_balance_entries(account_id,created_at);
revoke all on private.provider_usage_reservations,private.sms_outbox,private.video_rooms,
 private.customer_balance_accounts,private.customer_balance_entries from public,anon,authenticated;
commit;
