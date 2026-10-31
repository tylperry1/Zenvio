begin;
alter table private.delivery_jobs add column reply_to text;
create table private.thread_reply_addresses(
 thread_id uuid primary key references private.message_threads(id) on delete restrict,
 user_id uuid not null references public."user"(id) on delete restrict,
 token_hash text not null unique,token_ciphertext text not null,expected_sender text not null,
 expires_at timestamptz not null default now()+interval '90 days',created_at timestamptz not null default now()
);
create table private.inbound_email_receipts(
 provider_email_id text primary key,provider_event_id text not null unique,
 thread_id uuid references private.message_threads(id) on delete restrict,
 user_id uuid references public."user"(id) on delete restrict,
 state text not null check(state in ('accepted','quarantined','ignored')),
 reason text not null,body_digest text not null,created_at timestamptz not null default now()
);
revoke all on private.thread_reply_addresses,private.inbound_email_receipts from public,anon,authenticated;
commit;
