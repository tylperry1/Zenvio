begin;
-- Zenvio 2.1: AI assistant, messaging center, customer portal, contractor workflows,
-- booking personalization, intake uploads and feedback. Additive only.

-- AI assistant ---------------------------------------------------------------
create table private.ai_conversations(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."user"(id) on delete cascade,
  title text not null default 'New conversation' check(length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_conversations_owner on private.ai_conversations(user_id,updated_at desc);
create table private.ai_messages(
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references private.ai_conversations(id) on delete cascade,
  role text not null check(role in ('user','assistant')),
  content text not null check(length(content)<=40000),
  tools jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index ai_messages_conversation on private.ai_messages(conversation_id,created_at);
-- Every action the assistant proposes. Nothing runs until the signed-in user approves it,
-- and the row keeps the approved input and the backend's confirmed outcome.
create table private.ai_actions(
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references private.ai_conversations(id) on delete set null,
  user_id uuid not null references public."user"(id) on delete cascade,
  tool text not null check(length(tool)<=60),
  input jsonb not null,
  preview jsonb not null,
  status text not null default 'pending' check(status in ('pending','approved','rejected','succeeded','failed','expired')),
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '30 minutes',
  decided_at timestamptz,
  completed_at timestamptz
);
create index ai_actions_owner on private.ai_actions(user_id,created_at desc);
create table private.ai_usage(
  user_id uuid not null references public."user"(id) on delete cascade,
  day date not null,
  requests integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key(user_id,day)
);
create table private.ai_user_limits(
  user_id uuid primary key references public."user"(id) on delete cascade,
  enabled boolean not null default true,
  daily_requests integer check(daily_requests between 0 and 10000),
  monthly_tokens bigint check(monthly_tokens between 0 and 1000000000),
  updated_at timestamptz not null default now()
);
insert into private.platform_settings(key,value) values
  ('ai_assistant','{"enabled":true,"dailyRequests":60,"monthlyTokens":3000000}')
  on conflict(key) do nothing;

-- Feedback -------------------------------------------------------------------
create table private.feedback(
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public."user"(id) on delete set null,
  category text not null check(category in ('bug','idea','question','praise','other')),
  message text not null check(length(message) between 1 and 4000),
  page text not null default '' check(length(page)<=300),
  screenshot bytea check(octet_length(screenshot)<=2000000),
  status text not null default 'new' check(status in ('new','reviewing','planned','done','declined')),
  admin_note text not null default '' check(length(admin_note)<=2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index feedback_recent on private.feedback(created_at desc);
create index feedback_owner on private.feedback(user_id,created_at desc);

-- Messaging (temporary adapter storage until the shared messaging schema lands) --
create table private.message_threads(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."user"(id) on delete cascade,
  organization_id uuid references private.organizations(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  subject text not null default '' check(length(subject)<=200),
  status text not null default 'open' check(status in ('open','closed')),
  assigned_to uuid references public."user"(id) on delete set null,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index message_threads_contact on private.message_threads(user_id,contact_id) where contact_id is not null and booking_id is null;
create unique index message_threads_booking on private.message_threads(booking_id) where booking_id is not null;
create index message_threads_owner on private.message_threads(user_id,last_message_at desc);
create index message_threads_org on private.message_threads(organization_id,last_message_at desc);
create table private.thread_messages(
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references private.message_threads(id) on delete cascade,
  direction text not null check(direction in ('inbound','outbound','internal')),
  channel text not null check(channel in ('email','sms','portal','note')),
  author_id uuid references public."user"(id) on delete set null,
  author_name text not null default '' check(length(author_name)<=120),
  body text not null check(length(body) between 1 and 5000),
  status text not null check(status in ('received','queued','sent','delivered','failed','blocked')),
  status_detail text not null default '' check(length(status_detail)<=300),
  delivery_job_id uuid references private.delivery_jobs(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index thread_messages_thread on private.thread_messages(thread_id,created_at);
create index thread_messages_unread on private.thread_messages(thread_id) where direction='inbound' and read_at is null;
create table private.message_attachments(
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references private.message_threads(id) on delete cascade,
  message_id uuid references private.thread_messages(id) on delete cascade,
  filename text not null check(length(filename) between 1 and 160),
  content_type text not null check(content_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size integer not null check(size between 1 and 5000000),
  data bytea not null,
  created_at timestamptz not null default now()
);
create index message_attachments_message on private.message_attachments(message_id);
create table private.message_templates(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."user"(id) on delete cascade,
  name text not null check(length(name) between 1 and 80),
  body text not null check(length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  unique(user_id,name)
);

-- Customer portal --------------------------------------------------------------
create table private.portal_links(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."user"(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null default now()+interval '30 days',
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index portal_links_contact on private.portal_links(user_id,contact_id);

-- Booking page personalization -----------------------------------------------
alter table public.profiles
  add column website text not null default '' check(length(website)<=200),
  add column location text not null default '' check(length(location)<=120),
  add column social_links jsonb not null default '[]' check(jsonb_typeof(social_links)='array' and jsonb_array_length(social_links)<=6),
  add column booking_instructions text not null default '' check(length(booking_instructions)<=1000),
  add column industry text not null default 'general' check(industry in ('general','general_contractor','electrician','plumbing','hvac','cleaning','landscaping','handyman'));
create table private.profile_images(
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check(kind in ('cover','logo')),
  image bytea not null check(octet_length(image)<=1500000),
  updated_at timestamptz not null default now(),
  primary key(user_id,kind)
);

-- Intake attachments uploaded by guests before the booking is created ----------
create table private.intake_uploads(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."user"(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  job_id uuid,
  upload_key_hash text not null,
  filename text not null check(length(filename) between 1 and 160),
  content_type text not null check(content_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size integer not null check(size between 1 and 5000000),
  data bytea not null,
  created_at timestamptz not null default now()
);
create index intake_uploads_booking on private.intake_uploads(booking_id);
create index intake_uploads_orphans on private.intake_uploads(created_at) where booking_id is null and job_id is null;

-- Contractor workflows ----------------------------------------------------------
create table private.jobs(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."user"(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  title text not null check(length(title) between 1 and 120),
  category text not null default '' check(length(category)<=80),
  address text not null default '' check(length(address)<=300),
  description text not null default '' check(length(description)<=4000),
  preferred_time text not null default '' check(length(preferred_time)<=200),
  status text not null default 'requested' check(status in ('requested','approved','scheduled','in_progress','completed','cancelled','declined')),
  source text not null default 'manual' check(source in ('request_form','manual','assistant')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index jobs_owner on private.jobs(user_id,updated_at desc);
alter table private.intake_uploads add constraint intake_uploads_job foreign key(job_id) references private.jobs(id) on delete cascade;
create table private.job_activity(
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references private.jobs(id) on delete cascade,
  actor_id uuid,
  action text not null check(length(action)<=300),
  created_at timestamptz not null default now()
);
create index job_activity_job on private.job_activity(job_id,created_at desc);
create table private.estimates(
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references private.jobs(id) on delete cascade,
  user_id uuid not null references public."user"(id) on delete cascade,
  number integer not null,
  title text not null check(length(title) between 1 and 120),
  line_items jsonb not null default '[]' check(jsonb_typeof(line_items)='array'),
  tax_rate_bps integer not null default 0 check(tax_rate_bps between 0 and 3000),
  subtotal_cents integer not null default 0 check(subtotal_cents>=0),
  tax_cents integer not null default 0 check(tax_cents>=0),
  total_cents integer not null default 0 check(total_cents>=0),
  deposit_cents integer not null default 0 check(deposit_cents>=0 and deposit_cents<=total_cents),
  notes text not null default '' check(length(notes)<=2000),
  authorization_terms text not null default '' check(length(authorization_terms)<=4000),
  status text not null default 'draft' check(status in ('draft','sent','approved','declined','void')),
  approved_name text,
  approval_ip_hash text,
  sent_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,number)
);
create index estimates_job on private.estimates(job_id);
create table private.payment_requests(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."user"(id) on delete cascade,
  job_id uuid not null references private.jobs(id) on delete cascade,
  estimate_id uuid references private.estimates(id) on delete set null,
  kind text not null check(kind in ('deposit','final','other')),
  description text not null check(length(description) between 1 and 200),
  amount_cents integer not null check(amount_cents between 50 and 100000000),
  currency text not null default 'usd',
  status text not null default 'requested' check(status in ('requested','paid','cancelled','expired')),
  checkout_id text unique,
  checkout_url text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index payment_requests_job on private.payment_requests(job_id);

revoke all on private.ai_conversations,private.ai_messages,private.ai_actions,private.ai_usage,private.ai_user_limits,
  private.feedback,private.message_threads,private.thread_messages,private.message_attachments,private.message_templates,
  private.portal_links,private.profile_images,private.intake_uploads,private.jobs,private.job_activity,private.estimates,
  private.payment_requests from public,anon,authenticated;
commit;
