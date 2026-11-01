begin;
-- Guest checkout and idempotent marketplace order emails. Additive: existing
-- orders keep their user, and nothing about signed-in checkout changes.

alter table private.marketplace_orders alter column user_id drop not null;
alter table private.marketplace_orders
  add column if not exists guest_token_hash text unique check (guest_token_hash is null or length(guest_token_hash) = 64),
  -- Encrypted with the integration key so order emails can link guests back.
  add column if not exists guest_token_sealed text check (guest_token_sealed is null or length(guest_token_sealed) <= 400);
alter table private.marketplace_orders drop constraint if exists marketplace_orders_owner_present;
alter table private.marketplace_orders add constraint marketplace_orders_owner_present
  check (user_id is not null or guest_token_hash is not null);
create index if not exists marketplace_orders_guest_email on private.marketplace_orders(lower(customer_email), created_at desc) where user_id is null;

-- One row per order and email kind: a kind can only ever be sent once.
create table if not exists private.marketplace_order_emails (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references private.marketplace_orders(id) on delete cascade,
  kind text not null check (kind in ('confirmation','in_production','shipped','delivered','refunded','cancelled','artwork_approval','artwork_revision','delayed')),
  recipient text not null check (length(recipient) between 3 and 254),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text check (last_error is null or length(last_error) <= 300),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (order_id, kind)
);
create index if not exists marketplace_order_emails_pending on private.marketplace_order_emails(created_at) where sent_at is null;

alter table private.marketplace_order_emails enable row level security;
revoke all on private.marketplace_order_emails from public, anon, authenticated;
commit;
