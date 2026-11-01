begin;
-- Gelato as the first live supplier connector for the existing marketplace.
-- Additive only: no existing table, column, constraint or row is removed or
-- rewritten except to relax marketplace_orders.user_id for guest checkout.
-- Every new capability is disabled until an administrator enables it.

-- ---------- Supplier record (reuses the existing supplier table) ----------
insert into private.marketplace_suppliers(name,website,fulfillment,lead_time,notes,active,pipeline_status,categories,api_availability,connector,integration_status)
select 'Gelato','https://www.gelato.com','print_on_demand','','Print-on-demand partner. Products are imported only by explicit admin action.',false,
       'integration_in_progress',array['Custom apparel','Business printing','Promotional merchandise','Marketing materials'],'public_docs','gelato','credentials_pending'
where not exists (select 1 from private.marketplace_suppliers where connector='gelato');

-- ---------- Provider integration state (credentials stay in integration_secrets) ----------
create table if not exists private.supplier_integrations (
  provider text primary key check (provider ~ '^[a-z0-9_]{2,40}$'),
  enabled boolean not null default false,
  -- Live order submission is a separate switch from catalog access.
  fulfillment_enabled boolean not null default false,
  fulfillment_paused boolean not null default false,
  status text not null default 'not_configured' check (status in ('not_configured','connected','invalid_credentials','rate_limited','unavailable','error')),
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 500),
  last_error_at timestamptz,
  capabilities jsonb not null default '{}',
  last_catalog_sync_at timestamptz,
  last_catalog_sync_status text,
  webhook_token_hash text,
  webhook_last_received_at timestamptz,
  settings jsonb not null default '{}',
  updated_by uuid references public."user"(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into private.supplier_integrations(provider) values ('gelato') on conflict do nothing;

-- ---------- Imported supplier products (one per Zenvio marketplace product) ----------
create table if not exists private.supplier_products (
  id uuid primary key default gen_random_uuid(),
  provider text not null references private.supplier_integrations(provider),
  product_id uuid not null unique references private.marketplace_products(id),
  catalog_uid text not null check (length(catalog_uid) between 1 and 120),
  supplier_title text not null default '' check (length(supplier_title) <= 300),
  sync_enabled boolean not null default true,
  sync_status text not null default 'pending' check (sync_status in ('pending','ok','error')),
  sync_error text check (sync_error is null or length(sync_error) <= 500),
  last_synced_at timestamptz,
  -- Admin pricing controls; null falls back to the rule hierarchy.
  markup_bps integer check (markup_bps is null or markup_bps between 0 and 100000),
  min_margin_bps integer check (min_margin_bps is null or min_margin_bps between 0 and 9000),
  min_profit_cents integer check (min_profit_cents is null or min_profit_cents between 0 and 10000000),
  min_retail_cents integer check (min_retail_cents is null or min_retail_cents between 1 and 100000000),
  -- Print areas: [{key,label,width_mm,height_mm,bleed_mm,safe_mm,min_dpi,file_type}]
  print_areas jsonb not null default '[]',
  studio_enabled boolean not null default true,
  purchasing_paused boolean not null default false,
  paused_reason text check (paused_reason is null or length(paused_reason) <= 300),
  shipping_estimate text not null default '' check (length(shipping_estimate) <= 200),
  artwork_requirements text not null default '' check (length(artwork_requirements) <= 1000),
  created_by uuid references public."user"(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists private.supplier_variants (
  id uuid primary key default gen_random_uuid(),
  supplier_product_id uuid not null references private.supplier_products(id) on delete cascade,
  provider text not null,
  supplier_uid text not null check (length(supplier_uid) between 1 and 300),
  label text not null default '' check (length(label) <= 200),
  size text not null default '' check (length(size) <= 80),
  color text not null default '' check (length(color) <= 80),
  attributes jsonb not null default '{}',
  enabled boolean not null default true,
  availability text not null default 'unknown' check (availability in ('available','unavailable','unknown')),
  -- Cost per unit at quantity 1, in cents of cost_currency.
  cost_cents integer check (cost_cents is null or cost_cents between 0 and 100000000),
  cost_currency text not null default 'USD' check (cost_currency ~ '^[A-Z]{3}$'),
  -- [{quantity,cost_cents}] tiers returned by the supplier.
  price_tiers jsonb not null default '[]',
  -- Admin retail price per unit; null means use the pricing engine.
  retail_cents integer check (retail_cents is null or retail_cents between 1 and 100000000),
  weight_grams integer,
  dimensions jsonb not null default '{}',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  -- The same supplier SKU can never be imported twice.
  unique (provider, supplier_uid)
);
create index if not exists supplier_variants_product on private.supplier_variants(supplier_product_id);
create table if not exists private.supplier_price_snapshots (
  id bigserial primary key,
  variant_id uuid not null references private.supplier_variants(id) on delete cascade,
  quantity integer not null,
  cost_cents integer not null,
  currency text not null,
  country text not null default 'US',
  source text not null check (source in ('catalog_sync','checkout_quote','order')),
  captured_at timestamptz not null default now()
);
create index if not exists supplier_price_snapshots_variant on private.supplier_price_snapshots(variant_id, captured_at desc);

create table if not exists private.supplier_sync_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  kind text not null check (kind in ('connection_test','catalog_browse','product_import','product_refresh','catalog_refresh','order_sync')),
  status text not null default 'running' check (status in ('running','succeeded','failed','partial')),
  actor_id uuid references public."user"(id) on delete set null,
  summary jsonb not null default '{}',
  error text check (error is null or length(error) <= 500),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists supplier_sync_runs_time on private.supplier_sync_runs(provider, started_at desc);
create table if not exists private.supplier_api_errors (
  id bigserial primary key,
  provider text not null,
  operation text not null check (length(operation) <= 80),
  status_code integer,
  category text not null check (category in ('invalid_credentials','rate_limited','unavailable','network','invalid_response','rejected','unknown')),
  message text not null check (length(message) <= 500),
  order_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists supplier_api_errors_time on private.supplier_api_errors(provider, created_at desc);

-- ---------- Merchandising on the existing product ----------
alter table private.marketplace_products
  add column if not exists featured boolean not null default false;
-- Pricing rules gain a minimum margin; existing rules keep 0 (no margin floor).
alter table private.marketplace_pricing_rules
  add column if not exists min_margin_bps integer not null default 0 check (min_margin_bps between 0 and 9000);

-- ---------- Brand Studio ----------
create table if not exists private.brand_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public."user"(id) on delete cascade,
  -- Guest assets are bound to a hashed browser studio token instead of a user.
  guest_hash text check (guest_hash is null or guest_hash ~ '^[a-f0-9]{64}$'),
  filename text not null default '' check (length(filename) <= 200),
  source_format text not null check (source_format in ('png','jpeg','webp','svg')),
  mime text not null check (mime in ('image/png','image/jpeg')),
  image bytea not null check (octet_length(image) <= 12000000),
  width integer not null,
  height integer not null,
  has_alpha boolean not null default false,
  sha256 text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (user_id is not null or guest_hash is not null)
);
create index if not exists brand_assets_owner on private.brand_assets(user_id, created_at desc);
create index if not exists brand_assets_guest on private.brand_assets(guest_hash, created_at desc);
create table if not exists private.saved_designs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public."user"(id) on delete cascade,
  guest_hash text check (guest_hash is null or guest_hash ~ '^[a-f0-9]{64}$'),
  product_id uuid not null references private.marketplace_products(id),
  variant_id uuid not null references private.supplier_variants(id),
  name text not null default 'Untitled design' check (length(name) between 1 and 100),
  config jsonb not null,
  status text not null default 'draft' check (status in ('draft','approved')),
  validation jsonb not null default '{}',
  approved_at timestamptz,
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_id is not null or guest_hash is not null)
);
create index if not exists saved_designs_owner on private.saved_designs(user_id, updated_at desc);
-- Production files generated server-side from an approved design revision.
create table if not exists private.design_proofs (
  id uuid primary key default gen_random_uuid(),
  design_id uuid not null references private.saved_designs(id) on delete cascade,
  design_revision integer not null,
  area text not null check (length(area) <= 40),
  file bytea not null check (octet_length(file) <= 40000000),
  mime text not null check (mime in ('application/pdf')),
  sha256 text not null,
  width_mm numeric(8,2) not null,
  height_mm numeric(8,2) not null,
  min_effective_dpi integer,
  warnings jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (design_id, design_revision, area)
);

-- ---------- Order extensions (existing orders keep working unchanged) ----------
alter table private.marketplace_orders alter column user_id drop not null;
alter table private.marketplace_orders
  add column if not exists guest boolean not null default false,
  add column if not exists order_number text unique,
  add column if not exists discount_cents integer not null default 0 check (discount_cents >= 0),
  add column if not exists processing_fee_cents integer,
  add column if not exists supplier_cost_cents integer,
  add column if not exists supplier_shipping_cents integer;
alter table private.marketplace_order_items
  add column if not exists supplier_variant_id uuid references private.supplier_variants(id),
  add column if not exists supplier_variant_uid text,
  add column if not exists design_id uuid references private.saved_designs(id),
  add column if not exists design_revision integer,
  add column if not exists print_files jsonb not null default '[]',
  add column if not exists cost_snapshot jsonb;

-- Hashed, expiring links for guest order access. Raw tokens are never stored.
create table if not exists private.marketplace_order_access (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  order_id uuid not null references private.marketplace_orders(id),
  purpose text not null check (purpose in ('guest_view')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists marketplace_order_access_order on private.marketplace_order_access(order_id);
create table if not exists private.marketplace_lookup_attempts (
  id bigserial primary key,
  key_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists marketplace_lookup_attempts_key on private.marketplace_lookup_attempts(key_hash, created_at desc);

-- ---------- Supplier fulfillment ----------
create table if not exists private.supplier_orders (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references private.marketplace_orders(id),
  provider text not null,
  -- Sent as the supplier's order reference; makes resubmission detectable.
  reference_id text not null unique,
  status text not null default 'pending' check (status in (
    'pending','awaiting_artwork','ready','submitting','uncertain','submitted','accepted','in_production',
    'shipped','delivered','failed','needs_review','cancelled')),
  supplier_order_id text unique,
  supplier_status text,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  locked_until timestamptz,
  last_error text check (last_error is null or length(last_error) <= 500),
  payload_sha256 text,
  -- Supplier quote captured at checkout (costs and the chosen shipment method).
  quote jsonb,
  shipment_method_uid text check (shipment_method_uid is null or length(shipment_method_uid) <= 200),
  supplier_cost_cents integer,
  supplier_shipping_cents integer,
  supplier_currency text,
  submitted_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, provider)
);
create index if not exists supplier_orders_status on private.supplier_orders(status, next_attempt_at);
create table if not exists private.supplier_shipments (
  id uuid primary key default gen_random_uuid(),
  supplier_order_id uuid not null references private.supplier_orders(id),
  tracking_code text not null check (length(tracking_code) between 1 and 200),
  tracking_url text not null default '' check (length(tracking_url) <= 1000),
  carrier text not null default '' check (length(carrier) <= 200),
  status text not null default 'shipped',
  shipped_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (supplier_order_id, tracking_code)
);
create table if not exists private.supplier_order_events (
  id bigserial primary key,
  supplier_order_id uuid not null references private.supplier_orders(id),
  action text not null check (length(action) <= 80),
  detail text not null default '' check (length(detail) <= 1000),
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists supplier_order_events_order on private.supplier_order_events(supplier_order_id, created_at);
create table if not exists private.supplier_webhook_events (
  id text primary key check (length(id) <= 200),
  provider text not null,
  received_at timestamptz not null default now()
);

-- One row per (order, notification, key): emails are sent at most once.
create table if not exists private.marketplace_notifications (
  id uuid primary key default gen_random_uuid(),
  -- Null only for administrator alerts that are not tied to an order.
  order_id uuid references private.marketplace_orders(id),
  kind text not null check (kind in ('order_confirmation','artwork_approved','artwork_revision','submitted','shipped','delivered','cancelled','refunded','exception','admin_alert')),
  dedupe_key text not null default '',
  recipient text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  attempts integer not null default 0,
  error text check (error is null or length(error) <= 300),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (order_id, kind, dedupe_key)
);
create unique index if not exists marketplace_notifications_unbound on private.marketplace_notifications(kind, dedupe_key) where order_id is null;
create index if not exists marketplace_notifications_pending on private.marketplace_notifications(status, created_at);

alter table private.supplier_integrations enable row level security;
alter table private.supplier_products enable row level security;
alter table private.supplier_variants enable row level security;
alter table private.supplier_price_snapshots enable row level security;
alter table private.supplier_sync_runs enable row level security;
alter table private.supplier_api_errors enable row level security;
alter table private.brand_assets enable row level security;
alter table private.saved_designs enable row level security;
alter table private.design_proofs enable row level security;
alter table private.marketplace_order_access enable row level security;
alter table private.marketplace_lookup_attempts enable row level security;
alter table private.supplier_orders enable row level security;
alter table private.supplier_shipments enable row level security;
alter table private.supplier_order_events enable row level security;
alter table private.supplier_webhook_events enable row level security;
alter table private.marketplace_notifications enable row level security;
revoke all on private.supplier_integrations, private.supplier_products, private.supplier_variants, private.supplier_price_snapshots,
  private.supplier_sync_runs, private.supplier_api_errors, private.brand_assets, private.saved_designs, private.design_proofs,
  private.marketplace_order_access, private.marketplace_lookup_attempts, private.supplier_orders, private.supplier_shipments,
  private.supplier_order_events, private.supplier_webhook_events, private.marketplace_notifications
  from public, anon, authenticated;
commit;
