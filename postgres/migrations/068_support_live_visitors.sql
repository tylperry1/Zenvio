begin;
-- Website visitor chat, employee alerts and visitor reply emails for native
-- support. Additive: existing tickets keep their account owner.

-- Visitors have no account; their conversation is reached with a private token
-- (hash stored, encrypted copy for links in reply emails).
alter table private.support_tickets alter column user_id drop not null;
alter table private.support_tickets
  add column if not exists visitor_name text check (visitor_name is null or length(visitor_name) between 1 and 100),
  add column if not exists visitor_email text check (visitor_email is null or length(visitor_email) between 3 and 254),
  add column if not exists visitor_token_hash text unique check (visitor_token_hash is null or length(visitor_token_hash) = 64),
  add column if not exists visitor_token_sealed text check (visitor_token_sealed is null or length(visitor_token_sealed) <= 400);
alter table private.support_tickets drop constraint if exists support_tickets_owner_present;
alter table private.support_tickets add constraint support_tickets_owner_present check (
  user_id is not null
  or (visitor_token_hash is not null and visitor_email is not null and visitor_name is not null)
);
create index if not exists support_ticket_visitor_email on private.support_tickets(lower(visitor_email), created_at desc) where user_id is null;

-- Employees choose whether they're emailed about new chats while away.
alter table private.support_agents add column if not exists email_alerts boolean not null default true;

-- Support emails that don't belong to a customer workspace (and so don't use
-- its email allowance): replies to website visitors and alerts to employees.
create table if not exists private.support_notifications (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references private.support_tickets(id) on delete cascade,
  kind text not null check (kind in ('visitor_reply','staff_new_ticket','staff_customer_reply')),
  recipient text not null check (length(recipient) between 3 and 254),
  recipient_user uuid references public."user"(id) on delete cascade,
  dedupe_key text not null unique check (length(dedupe_key) <= 200),
  subject text not null check (length(subject) between 1 and 200),
  -- Encrypted: visitor reply links carry the conversation token.
  payload_sealed text not null check (length(payload_sealed) <= 20000),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text check (last_error is null or length(last_error) <= 300),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists support_notifications_pending on private.support_notifications(created_at) where sent_at is null;

alter table private.support_notifications enable row level security;
revoke all on private.support_notifications from public, anon, authenticated;
commit;
