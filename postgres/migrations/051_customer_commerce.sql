begin;
alter table private.customer_balance_accounts add column frozen boolean not null default false;
create table private.growth_offers(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public."user"(id) on delete restrict,
 kind text not null check(kind in ('package','membership','gift_card')),title text not null,description text not null default '',
 price_cents integer not null check(price_cents between 50 and 10000000),credit_units integer not null check(credit_units between 1 and 100000000),
 unit text not null check(unit ~ '^[A-Z_]{2,24}$'),active boolean not null default false,created_at timestamptz not null default now()
);
create index growth_offers_owner_idx on private.growth_offers(user_id,created_at);
create table private.growth_coupons(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public."user"(id) on delete restrict,
 code text not null,percent_off integer not null check(percent_off between 1 and 90),maximum_uses integer not null check(maximum_uses between 1 and 100000),
 expires_at timestamptz not null,active boolean not null default true,created_at timestamptz not null default now(),unique(user_id,code)
);
create table private.growth_orders(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public."user"(id) on delete restrict,
 offer_id uuid not null references private.growth_offers(id) on delete restrict,contact_id uuid not null references public.contacts(id) on delete restrict,
 reference uuid not null,digest text not null,snapshot jsonb not null,amount_cents integer not null check(amount_cents>=50),
 recipient_email text not null,stripe_account_id text not null,stripe_session_id text unique,payment_intent_id text,
 coupon_id uuid references private.growth_coupons(id) on delete restrict,
 state text not null default 'pending' check(state in ('pending','paid','expired','refunded','disputed')),
 expires_at timestamptz not null default now()+interval '31 minutes',created_at timestamptz not null default now(),paid_at timestamptz,
 unique(user_id,reference)
);
create index growth_orders_owner_idx on private.growth_orders(user_id,created_at);
create index growth_orders_coupon_idx on private.growth_orders(coupon_id,state,expires_at);
create table private.growth_memberships(
 order_id uuid primary key references private.growth_orders(id) on delete restrict,
 user_id uuid not null references public."user"(id) on delete restrict,stripe_subscription_id text not null unique,
 stripe_customer_id text not null,status text not null,current_period_end timestamptz,updated_at timestamptz not null default now()
);
create table private.growth_settlements(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references private.growth_orders(id) on delete restrict,
 user_id uuid not null references public."user"(id) on delete restrict,provider_reference text not null,
 payment_intent_id text,amount_paid_cents integer not null check(amount_paid_cents>0),credits integer not null check(credits>0),
 balance_account_id uuid references private.customer_balance_accounts(id),grant_entry_id uuid references private.customer_balance_entries(id),
 refunded_cents integer not null default 0,refunded_credits integer not null default 0,credit_debt integer not null default 0 check(credit_debt>=0),
 created_at timestamptz not null default now(),unique(user_id,provider_reference)
);
create unique index growth_settlement_payment_idx on private.growth_settlements(payment_intent_id);
create table private.growth_gift_cards(
 id uuid primary key default gen_random_uuid(),order_id uuid not null unique references private.growth_orders(id) on delete restrict,
 settlement_id uuid not null unique references private.growth_settlements(id) on delete restrict,user_id uuid not null references public."user"(id) on delete restrict,
 code_hash text not null unique,code_ciphertext text not null,value integer not null check(value>=0),
 state text not null default 'issued' check(state in ('issued','redeemed','void')),contact_id uuid references public.contacts(id),
 balance_account_id uuid references private.customer_balance_accounts(id),redeemed_at timestamptz,created_at timestamptz not null default now()
);
create table private.growth_provider_events(
 provider_event_id text primary key,account_id text not null,type text not null,processed_at timestamptz not null default now()
);
revoke all on private.growth_offers,private.growth_coupons,private.growth_orders,private.growth_memberships,private.growth_settlements,private.growth_gift_cards,private.growth_provider_events from public,anon,authenticated;
commit;
