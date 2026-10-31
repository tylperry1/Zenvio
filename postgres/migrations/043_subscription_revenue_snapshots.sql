begin;
create table private.subscription_revenue_snapshots(
 user_id uuid primary key references public."user"(id) on delete restrict,
 subscription_id text not null,currency text,
 mrr_cents numeric(18,4),status text not null,
 complete boolean not null,issue text,
 source text not null default 'stripe_reconciled' check(source='stripe_reconciled'),
 reconciled_at timestamptz not null default now()
);
revoke all on private.subscription_revenue_snapshots from public,anon,authenticated;
commit;
