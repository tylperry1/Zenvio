begin;
-- Support Operations Center: expanded ticket lifecycle, SLA, tags, events,
-- knowledge base, teams, and granular agent capabilities. Additive on the
-- existing private.support_* schema (066–068).

-- Expanded ticket statuses (map legacy pending → waiting_customer).
alter table private.support_tickets drop constraint if exists support_tickets_status_check;
update private.support_tickets set status = 'waiting_customer' where status = 'pending';
alter table private.support_tickets
  add constraint support_tickets_status_check check (status in (
    'new','open','in_progress','waiting_customer','waiting_internal','escalated','resolved','closed'
  ));

alter table private.support_tickets
  add column if not exists subcategory text not null default '' check (length(subcategory) <= 80),
  add column if not exists tags text[] not null default '{}',
  add column if not exists escalation_level smallint not null default 0 check (escalation_level between 0 and 5),
  add column if not exists escalated_at timestamptz,
  add column if not exists escalated_by uuid references public."user"(id) on delete set null,
  add column if not exists escalation_reason text not null default '' check (length(escalation_reason) <= 500),
  add column if not exists resolution_notes text not null default '' check (length(resolution_notes) <= 4000),
  add column if not exists merged_into uuid references private.support_tickets(id) on delete set null,
  add column if not exists duplicate_of uuid references private.support_tickets(id) on delete set null,
  add column if not exists team_id uuid,
  add column if not exists sla_first_due_at timestamptz,
  add column if not exists sla_resolve_due_at timestamptz,
  add column if not exists sla_first_breached boolean,
  add column if not exists sla_resolve_breached boolean,
  add column if not exists closed_at timestamptz,
  add column if not exists reopened_at timestamptz,
  add column if not exists last_customer_at timestamptz,
  add column if not exists last_staff_at timestamptz;

create index if not exists support_ticket_status_priority
  on private.support_tickets(status, priority, updated_at desc);
create index if not exists support_ticket_sla_resolve
  on private.support_tickets(sla_resolve_due_at)
  where status not in ('resolved','closed') and sla_resolve_due_at is not null;
create index if not exists support_ticket_tags on private.support_tickets using gin (tags);
create index if not exists support_ticket_merged on private.support_tickets(merged_into) where merged_into is not null;

-- Complete event history for every ticket mutation.
create table if not exists private.support_ticket_events (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references private.support_tickets(id) on delete cascade,
  actor_id uuid references public."user"(id) on delete set null,
  kind text not null check (length(kind) between 1 and 60),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists support_ticket_events_ticket on private.support_ticket_events(ticket_id, id);

-- Support teams / queues.
create table if not exists private.support_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(name) between 1 and 80),
  description text not null default '' check (length(description) <= 400),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table private.support_tickets
  drop constraint if exists support_tickets_team_id_fkey;
alter table private.support_tickets
  add constraint support_tickets_team_id_fkey
  foreign key (team_id) references private.support_teams(id) on delete set null;

create table if not exists private.support_team_members (
  team_id uuid not null references private.support_teams(id) on delete cascade,
  user_id uuid not null references public."user"(id) on delete cascade,
  primary key (team_id, user_id)
);

-- Granular capabilities for support representatives (beyond the coarse "support" staff permission).
alter table private.support_agents
  add column if not exists capabilities text[] not null default '{inbox,reply,assign,notes,attachments}',
  add column if not exists team_id uuid references private.support_teams(id) on delete set null,
  add column if not exists display_title text not null default '' check (length(display_title) <= 80);

-- Configurable SLA targets (minutes). Null targets mean "not configured" — never claim compliance.
create table if not exists private.support_sla_policies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(name) between 1 and 80),
  priority text not null check (priority in ('low','normal','high','urgent')),
  first_response_minutes integer check (first_response_minutes is null or first_response_minutes > 0),
  resolve_minutes integer check (resolve_minutes is null or resolve_minutes > 0),
  business_hours_only boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (priority)
);

insert into private.support_sla_policies(name, priority, first_response_minutes, resolve_minutes, business_hours_only)
values
  ('Urgent', 'urgent', 30, 240, false),
  ('High', 'high', 60, 480, false),
  ('Normal', 'normal', 240, 2880, true),
  ('Low', 'low', 480, 5760, true)
on conflict (priority) do nothing;

create table if not exists private.support_business_hours (
  id smallint primary key default 1 check (id = 1),
  timezone text not null default 'America/New_York' check (length(timezone) between 1 and 60),
  monday text not null default '09:00-17:00',
  tuesday text not null default '09:00-17:00',
  wednesday text not null default '09:00-17:00',
  thursday text not null default '09:00-17:00',
  friday text not null default '09:00-17:00',
  saturday text not null default 'off',
  sunday text not null default 'off'
);
insert into private.support_business_hours(id) values (1) on conflict do nothing;

create table if not exists private.support_escalation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  from_priority text check (from_priority is null or from_priority in ('low','normal','high','urgent')),
  after_minutes integer not null check (after_minutes > 0),
  to_priority text not null check (to_priority in ('low','normal','high','urgent')),
  assign_team_id uuid references private.support_teams(id) on delete set null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

-- Knowledge base (internal + customer-facing).
create table if not exists private.support_kb_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(name) between 1 and 80),
  slug text not null unique check (length(slug) between 1 and 80),
  audience text not null default 'both' check (audience in ('internal','customer','both')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists private.support_kb_articles (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references private.support_kb_categories(id) on delete set null,
  title text not null check (length(title) between 1 and 160),
  slug text not null unique check (length(slug) between 1 and 160),
  body text not null check (length(body) between 1 and 50000),
  audience text not null default 'internal' check (audience in ('internal','customer','both')),
  published boolean not null default false,
  version integer not null default 1 check (version >= 1),
  author_id uuid references public."user"(id) on delete set null,
  updated_by uuid references public."user"(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists support_kb_articles_search on private.support_kb_articles using gin (to_tsvector('english', title || ' ' || body));

create table if not exists private.support_kb_versions (
  id bigint generated always as identity primary key,
  article_id uuid not null references private.support_kb_articles(id) on delete cascade,
  version integer not null check (version >= 1),
  title text not null,
  body text not null,
  editor_id uuid references public."user"(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (article_id, version)
);

-- Message templates (distinct from short saved replies).
create table if not exists private.support_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 100),
  category text not null default 'general' check (length(category) between 1 and 40),
  body text not null check (length(body) between 1 and 8000),
  audience text not null default 'customer' check (audience in ('customer','internal')),
  created_by uuid references public."user"(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Internal mentions on tickets / notes.
create table if not exists private.support_mentions (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references private.support_tickets(id) on delete cascade,
  message_id bigint references private.support_messages(id) on delete cascade,
  mentioned_user uuid not null references public."user"(id) on delete cascade,
  actor_id uuid references public."user"(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists support_mentions_user on private.support_mentions(mentioned_user, created_at desc) where read_at is null;

-- Seed default teams.
insert into private.support_teams(name, description)
values
  ('General', 'Default customer support queue'),
  ('Billing', 'Billing and subscription questions'),
  ('Technical', 'Product defects and technical issues')
on conflict (name) do nothing;

alter table private.support_ticket_events enable row level security;
alter table private.support_teams enable row level security;
alter table private.support_team_members enable row level security;
alter table private.support_sla_policies enable row level security;
alter table private.support_business_hours enable row level security;
alter table private.support_escalation_rules enable row level security;
alter table private.support_kb_categories enable row level security;
alter table private.support_kb_articles enable row level security;
alter table private.support_kb_versions enable row level security;
alter table private.support_templates enable row level security;
alter table private.support_mentions enable row level security;

revoke all on private.support_ticket_events, private.support_teams, private.support_team_members,
  private.support_sla_policies, private.support_business_hours, private.support_escalation_rules,
  private.support_kb_categories, private.support_kb_articles, private.support_kb_versions,
  private.support_templates, private.support_mentions
  from public, anon, authenticated;

commit;
