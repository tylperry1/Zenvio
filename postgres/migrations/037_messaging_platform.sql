begin;

create table private.messaging_threads(
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public."user"(id) on delete restrict,
  contact_id uuid references public.contacts(id) on delete set null,
  channel text not null check(channel in ('email','sms')),
  participant_address text not null,
  participant_name text,
  subject text,
  latest_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,channel,participant_address)
);

create table private.message_records(
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references private.messaging_threads(id) on delete restrict,
  user_id text not null references public."user"(id) on delete restrict,
  channel text not null check(channel in ('email','sms')),
  direction text not null check(direction in ('inbound','outbound')),
  state text not null check(state in ('draft','queued','sending','provider_accepted','delivered','failed','suppressed','received')),
  body text not null check(length(body) between 1 and 1600),
  provider text check(provider in ('resend','twilio')),
  provider_message_id text,
  idempotency_key text,
  failure_code text,
  failure_message text,
  provider_cost_micros bigint check(provider_cost_micros is null or provider_cost_micros >= 0),
  provider_cost_currency text,
  sent_at timestamptz,
  delivered_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id,idempotency_key)
);

create unique index message_records_provider_id_idx
  on private.message_records(provider,provider_message_id)
  where provider_message_id is not null;
create index message_records_thread_idx on private.message_records(thread_id,created_at desc);
create index message_records_state_idx on private.message_records(state,created_at) where state in ('queued','sending','failed');

create table private.communication_templates(
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public."user"(id) on delete restrict,
  channel text not null check(channel in ('email','sms')),
  purpose text not null check(purpose in ('booking_link','appointment_confirmation','appointment_reminder','document_signing','payment_request','custom')),
  name text not null check(length(name) between 1 and 120),
  body text not null check(length(body) between 1 and 1600),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.contact_consents(
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public."user"(id) on delete restrict,
  contact_id uuid references public.contacts(id) on delete set null,
  phone_e164 text not null check(phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
  scope text not null check(scope in ('transactional','appointment','marketing')),
  status text not null check(status in ('opted_in','opted_out')),
  source text not null check(source in ('booking_form','written','verbal','keyword','import','admin')),
  country_code text not null check(country_code ~ '^[A-Z]{2}$'),
  evidence jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique(user_id,phone_e164,scope)
);
create index contact_consents_lookup_idx on private.contact_consents(user_id,phone_e164,status);

create table private.provider_webhook_events(
  provider text not null check(provider in ('twilio','resend','google','microsoft','stripe')),
  provider_event_id text not null,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  payload_digest text not null,
  last_error text,
  primary key(provider,provider_event_id)
);

create table private.email_suppressions(
  email_hash text primary key,
  reason text not null check(reason in ('bounce','complaint','manual')),
  provider text not null default 'resend' check(provider='resend'),
  provider_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.provider_connection_health(
  provider text not null,
  user_id text references public."user"(id) on delete cascade,
  state text not null check(state in ('unconfigured','connecting','healthy','degraded','action_required')),
  issue_code text,
  action text,
  last_success_at timestamptz,
  last_checked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index provider_connection_health_scope_idx
  on private.provider_connection_health(provider,coalesce(user_id,''));

create table private.sms_provider_connections(
  user_id text primary key references public."user"(id) on delete restrict,
  provider text not null default 'twilio' check(provider='twilio'),
  sender_number text not null unique check(sender_number ~ '^\\+[1-9][0-9]{7,14}$'),
  registration_state text not null default 'unregistered'
    check(registration_state in ('unregistered','pending','approved','rejected','not_required')),
  messaging_enabled boolean not null default false,
  country_code text not null check(country_code ~ '^[A-Z]{2}$'),
  updated_at timestamptz not null default now()
);

revoke all on private.messaging_threads, private.message_records,
  private.communication_templates, private.contact_consents,
  private.provider_webhook_events, private.provider_connection_health,
  private.sms_provider_connections, private.email_suppressions
  from public,anon,authenticated;

commit;
