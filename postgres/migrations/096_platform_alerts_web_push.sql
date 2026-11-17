begin;
-- In-app platform alert inbox (admin notification bell) and Web Push
-- subscriptions for device delivery of platform alerts.

create table if not exists private.platform_alerts (
  id bigint generated always as identity primary key,
  recipient_user_id uuid not null references public."user"(id) on delete cascade,
  kind text not null check (length(kind) between 1 and 60),
  title text not null check (length(title) between 1 and 160),
  body text not null default '' check (length(body) <= 500),
  href text not null default '' check (length(href) <= 400),
  dedupe_key text not null check (length(dedupe_key) between 1 and 200),
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recipient_user_id, dedupe_key)
);
create index if not exists platform_alerts_inbox
  on private.platform_alerts(recipient_user_id, created_at desc)
  where read_at is null;
create index if not exists platform_alerts_recent
  on private.platform_alerts(recipient_user_id, created_at desc);

create table if not exists private.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."user"(id) on delete cascade,
  endpoint text not null unique check (length(endpoint) between 10 and 2000),
  p256dh text not null check (length(p256dh) between 1 and 200),
  auth text not null check (length(auth) between 1 and 200),
  user_agent text not null default '' check (length(user_agent) <= 400),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_error text check (last_error is null or length(last_error) <= 300)
);
create index if not exists push_subscriptions_user
  on private.push_subscriptions(user_id, last_seen_at desc);

-- Allow web_push as a notification_attempts provider alongside firebase stub.
alter table private.notification_attempts drop constraint if exists notification_attempts_provider_check;
alter table private.notification_attempts
  add constraint notification_attempts_provider_check
  check (provider is null or provider in ('resend','telnyx','twilio','firebase','web_push'));

alter table private.platform_alerts enable row level security;
alter table private.push_subscriptions enable row level security;
revoke all on private.platform_alerts, private.push_subscriptions from public, anon, authenticated;

commit;
