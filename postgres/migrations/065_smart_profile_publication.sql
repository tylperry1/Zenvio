begin;
alter table private.smart_profiles
  alter column published set default false,
  alter column show_phone set default false,
  alter column show_email set default false,
  add column archived_at timestamptz,
  add column capture_leads boolean not null default false,
  add constraint smart_profiles_archive_private check (archived_at is null or not published);

create table private.smart_profile_leads (
  profile_id uuid not null references private.smart_profiles(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  first_submitted_at timestamptz not null default now(),
  primary key (profile_id, contact_id)
);
alter table private.smart_profile_leads enable row level security;
revoke all on private.smart_profile_leads from public, anon, authenticated;

create table private.smart_profile_actions (
  profile_id uuid not null references private.smart_profiles(id) on delete cascade,
  day date not null,
  action text not null check (action in ('vcard', 'booking')),
  total integer not null default 0,
  primary key (profile_id, day, action)
);
alter table private.smart_profile_actions enable row level security;
revoke all on private.smart_profile_actions from public, anon, authenticated;
alter table private.smart_cards
  add column encoding_confirmed_at timestamptz,
  add column legacy_registration boolean not null default true;
alter table private.smart_cards alter column legacy_registration set default false;

create table private.smart_card_activity (
  id bigint generated always as identity primary key,
  card_id uuid not null references private.smart_cards(id) on delete cascade,
  action text not null check (action in ('registered', 'updated', 'encoding_confirmed')),
  profile_id uuid references private.smart_profiles(id) on delete set null,
  status text not null check (status in ('active', 'deactivated')),
  created_at timestamptz not null default now()
);
create index smart_card_activity_card on private.smart_card_activity(card_id);
alter table private.smart_card_activity enable row level security;
revoke all on private.smart_card_activity from public, anon, authenticated;
commit;
