begin;
-- Digital Identity ecosystem: typed profiles, slug redirects, richer attribution,
-- NFC→profile linkage. Does not invent plan pricing — capacity stays app-enforced.

-- ---------- Profile kinds & visibility ----------
alter table private.smart_profiles
  add column if not exists profile_kind text not null default 'individual'
    check (profile_kind in ('individual','business','employee','team','brand')),
  add column if not exists visibility text not null default 'public'
    check (visibility in ('public','unlisted','private'));

-- Private visibility keeps the profile unpublished for public resolution.
update private.smart_profiles
   set visibility = case when published then 'public' else 'private' end
 where visibility = 'public' and published is distinct from true;

comment on column private.smart_profiles.profile_kind is
  'Canonical Digital Identity type: individual, business, employee, team, or brand.';
comment on column private.smart_profiles.visibility is
  'public = published & linkable; unlisted = published but not indexed; private = unpublished.';

-- ---------- Safe slug changes with redirects ----------
create table if not exists private.smart_profile_slug_redirects (
  old_slug text primary key check (old_slug ~ '^[a-z0-9][a-z0-9-]{2,49}$'),
  profile_id uuid not null references private.smart_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists smart_profile_slug_redirects_profile
  on private.smart_profile_slug_redirects(profile_id);
alter table private.smart_profile_slug_redirects enable row level security;
revoke all on private.smart_profile_slug_redirects from public, anon, authenticated;

-- ---------- View channels: add nfc (physical card remains card) ----------
alter table private.smart_profile_views drop constraint if exists smart_profile_views_channel_check;
alter table private.smart_profile_views
  add constraint smart_profile_views_channel_check
  check (channel in ('link','card','qr','nfc'));

-- ---------- Action taxonomy for contact exchange & outbound clicks ----------
alter table private.smart_profile_actions drop constraint if exists smart_profile_actions_action_check;
alter table private.smart_profile_actions
  add constraint smart_profile_actions_action_check
  check (action in (
    'vcard','booking','phone','email','website','social','share','copy_link'
  ));

-- ---------- Per-source attribution (card / NFC tag / QR campaign) ----------
create table if not exists private.smart_profile_attribution (
  id bigint generated always as identity primary key,
  profile_id uuid not null references private.smart_profiles(id) on delete cascade,
  day date not null default ((now() at time zone 'UTC')::date),
  channel text not null check (channel in ('link','card','qr','nfc')),
  card_id uuid references private.smart_cards(id) on delete set null,
  nfc_tag_id uuid references private.nfc_tags(id) on delete set null,
  event text not null check (event in ('view','vcard','booking','phone','email','website','social','share','copy_link','lead')),
  total integer not null default 0 check (total >= 0),
  -- NULLS NOT DISTINCT (PG 15+) so one aggregate bucket per source combo.
  unique nulls not distinct (profile_id, day, channel, event, card_id, nfc_tag_id)
);
create index if not exists smart_profile_attribution_owner_day
  on private.smart_profile_attribution(profile_id, day desc);
alter table private.smart_profile_attribution enable row level security;
revoke all on private.smart_profile_attribution from public, anon, authenticated;

-- ---------- NFC tags can point at a Digital Identity (in addition to a card) ----------
alter table private.nfc_tags
  add column if not exists profile_id uuid references private.smart_profiles(id) on delete set null;
create index if not exists nfc_tags_profile on private.nfc_tags(profile_id)
  where profile_id is not null;

-- Programmed NFC destinations prefer the stable card URL (/c/{token}?src=nfc)
-- so reassignment does not require rewriting physical tags when content changes.
comment on column private.nfc_tags.profile_id is
  'Authorized Digital Identity this tag is assigned to; destination_url remains the programmed URL.';

commit;
