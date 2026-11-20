begin;
-- NFC Studio: registered tags, operation history, and batch programming.
-- Owner-scoped like smart_cards (user_id). Hardware IDs are optional and privacy-sensitive.

create table if not exists private.nfc_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."user"(id) on delete cascade,
  smart_card_id uuid references private.smart_cards(id) on delete set null,
  label text not null default '' check (length(label) <= 120),
  tag_type text not null default '' check (length(tag_type) <= 80),
  technology text not null default '' check (length(technology) <= 80),
  capacity_bytes integer check (capacity_bytes is null or capacity_bytes between 0 and 1048576),
  status text not null default 'registered' check (status in ('registered','programmed','assigned','failed','retired','lost')),
  destination_url text not null default '' check (length(destination_url) <= 500),
  hardware_identifier text check (hardware_identifier is null or length(hardware_identifier) <= 120),
  notes text not null default '' check (length(notes) <= 2000),
  last_scanned_at timestamptz,
  last_programmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists nfc_tags_owner on private.nfc_tags(user_id, created_at desc);
create index if not exists nfc_tags_card on private.nfc_tags(smart_card_id) where smart_card_id is not null;
create index if not exists nfc_tags_status on private.nfc_tags(user_id, status);

create table if not exists private.nfc_operations (
  id uuid primary key default gen_random_uuid(),
  tag_id uuid references private.nfc_tags(id) on delete set null,
  user_id uuid not null references public."user"(id) on delete cascade,
  operation_type text not null check (operation_type in ('read','write','verify','program_smart_card','lock','batch_item')),
  platform text not null default 'none' check (platform in ('ios-native','android-native','web-nfc','none')),
  device_type text not null default '' check (length(device_type) <= 80),
  status text not null default 'started' check (status in ('started','succeeded','failed','cancelled','unverified')),
  payload_type text not null default '' check (length(payload_type) <= 80),
  payload_summary text not null default '' check (length(payload_summary) <= 500),
  payload_hash text not null default '' check (length(payload_hash) <= 128),
  verification_status text not null default 'not_requested' check (verification_status in ('not_requested','matched','mismatched','unavailable')),
  error_code text not null default '' check (length(error_code) <= 80),
  error_message text not null default '' check (length(error_message) <= 500),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists nfc_operations_owner on private.nfc_operations(user_id, started_at desc);
create index if not exists nfc_operations_tag on private.nfc_operations(tag_id, started_at desc);

create table if not exists private.nfc_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."user"(id) on delete cascade,
  smart_card_id uuid references private.smart_cards(id) on delete set null,
  name text not null check (length(name) between 1 and 120),
  destination_url text not null default '' check (length(destination_url) <= 500),
  total_tags integer not null default 0 check (total_tags between 0 and 10000),
  successful_tags integer not null default 0 check (successful_tags between 0 and 10000),
  failed_tags integer not null default 0 check (failed_tags between 0 and 10000),
  status text not null default 'open' check (status in ('open','completed','cancelled')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists nfc_batches_owner on private.nfc_batches(user_id, created_at desc);

create table if not exists private.nfc_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references private.nfc_batches(id) on delete cascade,
  tag_id uuid references private.nfc_tags(id) on delete set null,
  operation_id uuid references private.nfc_operations(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','succeeded','failed','skipped')),
  error_code text not null default '' check (length(error_code) <= 80),
  completed_at timestamptz
);
create index if not exists nfc_batch_items_batch on private.nfc_batch_items(batch_id, completed_at desc nulls last);

-- Optional platform toggle (defaults enabled when smartCards feature is on).
insert into private.platform_settings(key, value)
  values ('nfc_studio', '{"enabled":true}'::jsonb)
  on conflict (key) do nothing;

alter table private.nfc_tags enable row level security;
alter table private.nfc_operations enable row level security;
alter table private.nfc_batches enable row level security;
alter table private.nfc_batch_items enable row level security;
revoke all on private.nfc_tags, private.nfc_operations, private.nfc_batches, private.nfc_batch_items
  from public, anon, authenticated;
commit;
