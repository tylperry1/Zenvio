begin;
-- Booking source attribution, booking-page view counts and verified reviews.
-- Additive only; no existing table or migration is changed.

create table if not exists private.booking_sources (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  user_id uuid not null references public."user"(id) on delete cascade,
  source text not null check (source ~ '^[a-z0-9][a-z0-9_.-]{0,39}$'),
  medium text check (medium is null or medium ~ '^[a-z0-9][a-z0-9_.-]{0,39}$'),
  campaign text check (campaign is null or length(campaign) <= 80),
  referrer_host text check (referrer_host is null or length(referrer_host) <= 255),
  created_at timestamptz not null default now()
);
create index if not exists booking_sources_owner_time on private.booking_sources(user_id, created_at desc);

-- Aggregate daily counts only: no visitor identifiers are stored.
create table if not exists private.booking_page_views (
  user_id uuid not null references public."user"(id) on delete cascade,
  day date not null,
  source text not null check (source ~ '^[a-z0-9][a-z0-9_.-]{0,39}$'),
  views integer not null default 0 check (views >= 0),
  primary key (user_id, day, source)
);

create table if not exists private.review_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."user"(id) on delete cascade,
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  token_hash text not null unique check (length(token_hash) = 64),
  recipient_email text not null,
  sent_at timestamptz,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists review_requests_owner on private.review_requests(user_id, created_at desc);

create table if not exists private.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."user"(id) on delete cascade,
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '' check (length(comment) <= 2000),
  display_name text check (display_name is null or length(display_name) between 1 and 60),
  public_consent boolean not null default false,
  -- Hiding is only for content-policy reasons; ratings always count in the public average.
  hidden_reason text check (hidden_reason is null or hidden_reason in ('personal_information','offensive','not_about_business','spam')),
  owner_reply text check (owner_reply is null or length(owner_reply) <= 1000),
  replied_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists reviews_owner_time on private.reviews(user_id, created_at desc);

alter table private.booking_sources enable row level security;
alter table private.booking_page_views enable row level security;
alter table private.review_requests enable row level security;
alter table private.reviews enable row level security;
revoke all on private.booking_sources, private.booking_page_views, private.review_requests, private.reviews from public, anon, authenticated;
commit;
