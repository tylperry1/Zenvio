begin;
-- Marketplace upgrade: supplier acquisition pipeline, category families,
-- pricing rules and NFC smart business profiles. Additive only: existing
-- products keep their category text, suppliers and orders are untouched.

-- ---------- Supplier acquisition (extends the existing supplier table) ----------
alter table private.marketplace_suppliers
  add column if not exists pipeline_status text not null default 'identified'
    check (pipeline_status in ('identified','contacted','application_submitted','awaiting_response','under_review','approved','integration_in_progress','testing','active','rejected','suspended')),
  add column if not exists categories text[] not null default '{}',
  add column if not exists application_url text not null default '' check (length(application_url) <= 500),
  add column if not exists api_availability text not null default 'unknown' check (api_availability in ('unknown','public_docs','partner_only','none')),
  add column if not exists connector text check (connector is null or connector ~ '^[a-z0-9_]{2,40}$'),
  add column if not exists reseller_requirements text not null default '' check (length(reseller_requirements) <= 2000),
  add column if not exists monthly_fee_cents integer check (monthly_fee_cents is null or monthly_fee_cents between 0 and 100000000),
  add column if not exists minimum_order text not null default '' check (length(minimum_order) <= 300),
  add column if not exists pricing_model text not null default '' check (length(pricing_model) <= 500),
  add column if not exists fulfillment_locations text not null default '' check (length(fulfillment_locations) <= 500),
  add column if not exists shipping_regions text not null default '' check (length(shipping_regions) <= 500),
  add column if not exists return_policy text not null default '' check (length(return_policy) <= 1000),
  add column if not exists agreement_status text not null default 'none' check (agreement_status in ('none','negotiating','signed','terminated')),
  add column if not exists integration_status text not null default 'not_started' check (integration_status in ('not_started','credentials_pending','configured','testing','live','error','disabled')),
  add column if not exists follow_up_on date,
  -- 1-5 per criterion; null means not yet evaluated.
  add column if not exists scorecard jsonb not null default '{}';

-- Suppliers already in use stay active in the new pipeline.
update private.marketplace_suppliers set pipeline_status='active' where active and pipeline_status='identified';

create table if not exists private.supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references private.marketplace_suppliers(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  role text not null default '' check (length(role) <= 120),
  email text not null default '' check (length(email) <= 254),
  phone text not null default '' check (length(phone) <= 40),
  created_at timestamptz not null default now()
);
create table if not exists private.supplier_activity (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references private.marketplace_suppliers(id) on delete cascade,
  actor_id uuid references public."user"(id) on delete set null,
  kind text not null check (kind in ('note','status','outreach','document','integration')),
  body text not null check (length(body) between 1 and 4000),
  url text check (url is null or length(url) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists supplier_activity_time on private.supplier_activity(supplier_id, created_at desc);

-- ---------- Category families (products keep their category name) ----------
create table if not exists private.marketplace_families (
  slug text primary key check (slug ~ '^[a-z][a-z-]{1,30}$'),
  name text not null,
  tagline text not null default '',
  sort integer not null default 0
);
create table if not exists private.marketplace_categories (
  name text primary key check (length(name) between 2 and 100),
  family text not null references private.marketplace_families(slug),
  sort integer not null default 0
);
insert into private.marketplace_families(slug,name,tagline,sort) values
  ('apparel','Custom apparel','Shirts, hoodies, hats and team wear with your logo',1),
  ('stationery','Business cards & stationery','Cards, letterhead and everyday paper essentials',2),
  ('marketing','Marketing materials','Flyers, postcards, stickers and mailers',3),
  ('promo','Promotional merchandise','Drinkware, pens, bags and corporate gifts',4),
  ('signs','Signs & displays','Banners, yard signs, decals and event displays',5),
  ('smart','NFC & smart products','Tap-to-share cards, review stands and smart tags',6)
on conflict (slug) do nothing;
insert into private.marketplace_categories(name,family,sort) values
  -- Existing categories, mapped without renaming any product.
  ('Branded apparel','apparel',0),('Business cards','stationery',0),('Print marketing','marketing',0),
  ('Promotional gifts','promo',0),('Branding kits','promo',1),('Signs & banners','signs',0),
  ('Marketing materials','marketing',1),
  ('T-shirts','apparel',1),('Polo shirts','apparel',2),('Hoodies & sweatshirts','apparel',3),('Jackets','apparel',4),
  ('Embroidered hats','apparel',5),('Work uniforms','apparel',6),('Team & performance apparel','apparel',7),
  ('Premium business cards','stationery',1),('Appointment cards','stationery',2),('Letterheads & envelopes','stationery',3),
  ('Notepads','stationery',4),('Presentation folders','stationery',5),
  ('Flyers','marketing',2),('Brochures','marketing',3),('Postcards','marketing',4),('Door hangers','marketing',5),
  ('Rack cards','marketing',6),('Stickers & labels','marketing',7),('Magnets','marketing',8),('Mailers','marketing',9),
  ('Drinkware','promo',2),('Pens','promo',3),('Tote bags','promo',4),('Notebooks','promo',5),('Lanyards & keychains','promo',6),
  ('Desk accessories','promo',7),('Corporate gifts','promo',8),
  ('Vinyl banners','signs',1),('Retractable banners','signs',2),('Yard signs','signs',3),('Window & wall graphics','signs',4),
  ('Vehicle magnets','signs',5),('Posters','signs',6),('Trade show displays','signs',7),('Table covers','signs',8),
  ('NFC business cards','smart',1),('NFC keychains & tags','smart',2),('NFC review stands','smart',3),
  ('NFC countertop displays','smart',4),('QR business cards','smart',5)
on conflict (name) do nothing;

-- ---------- Pricing rules ----------
-- Most specific rule wins: product > supplier > category > family > global.
create table if not exists private.marketplace_pricing_rules (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global','family','category','supplier')),
  scope_key text not null default '' check (length(scope_key) <= 100),
  markup_bps integer not null check (markup_bps between 0 and 100000),
  min_profit_cents integer not null default 0 check (min_profit_cents between 0 and 10000000),
  subscriber_discount_bps integer not null default 0 check (subscriber_discount_bps between 0 and 5000),
  updated_by uuid references public."user"(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (scope, scope_key)
);
insert into private.marketplace_pricing_rules(scope,scope_key,markup_bps,min_profit_cents) values ('global','',6000,300)
on conflict (scope,scope_key) do nothing;

-- ---------- NFC smart business profiles ----------
create table if not exists private.smart_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."user"(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,49}$'),
  display_name text not null check (length(display_name) between 1 and 100),
  company text not null default '' check (length(company) <= 120),
  job_title text not null default '' check (length(job_title) <= 120),
  bio text not null default '' check (length(bio) <= 500),
  phone text not null default '' check (length(phone) <= 40),
  email text not null default '' check (length(email) <= 254),
  website text not null default '' check (length(website) <= 500),
  address text not null default '' check (length(address) <= 300),
  links jsonb not null default '[]',
  show_booking boolean not null default true,
  show_phone boolean not null default true,
  show_email boolean not null default true,
  show_address boolean not null default false,
  accent text not null default '#365cff' check (accent ~ '^#[0-9a-fA-F]{6}$'),
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists smart_profiles_owner on private.smart_profiles(user_id);
-- Physical cards point at /c/<token>; the token is random and maps to a profile
-- that can change, so a lost card can be deactivated or reassigned.
create table if not exists private.smart_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."user"(id) on delete cascade,
  profile_id uuid references private.smart_profiles(id) on delete set null,
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{16,40}$'),
  label text not null default '' check (length(label) <= 80),
  kind text not null default 'card' check (kind in ('card','keychain','sticker','stand','tag')),
  status text not null default 'active' check (status in ('active','deactivated')),
  created_at timestamptz not null default now(),
  deactivated_at timestamptz
);
create index if not exists smart_cards_owner on private.smart_cards(user_id);
-- Aggregate daily counts only; no visitor identifiers.
create table if not exists private.smart_profile_views (
  profile_id uuid not null references private.smart_profiles(id) on delete cascade,
  day date not null,
  channel text not null check (channel in ('link','card','qr')),
  views integer not null default 0,
  primary key (profile_id, day, channel)
);

alter table private.supplier_contacts enable row level security;
alter table private.supplier_activity enable row level security;
alter table private.marketplace_families enable row level security;
alter table private.marketplace_categories enable row level security;
alter table private.marketplace_pricing_rules enable row level security;
alter table private.smart_profiles enable row level security;
alter table private.smart_cards enable row level security;
alter table private.smart_profile_views enable row level security;
revoke all on private.supplier_contacts, private.supplier_activity, private.marketplace_families, private.marketplace_categories,
  private.marketplace_pricing_rules, private.smart_profiles, private.smart_cards, private.smart_profile_views
  from public, anon, authenticated;
commit;
