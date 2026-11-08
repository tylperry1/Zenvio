begin;
-- Customer support: live chat conversations handled by Zenvio employees.
-- Additive only. Suggestions keep using private.feedback (migration 037).

create table if not exists private.support_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."user"(id) on delete cascade,
  subject text not null check (length(subject) between 1 and 160),
  category text not null default 'other'
    check (category in ('account','billing','bookings','documents','marketplace','technical','other')),
  -- open: waiting on Zenvio; waiting: waiting on the customer; resolved: done.
  status text not null default 'open' check (status in ('open','waiting','resolved')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assignee_id uuid references public."user"(id) on delete set null,
  page text not null default '' check (length(page) <= 300),
  customer_read_at timestamptz,
  staff_read_at timestamptz,
  last_message_at timestamptz not null default now(),
  last_customer_message_at timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,
  rating smallint check (rating is null or rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_conversations_owner on private.support_conversations(user_id, last_message_at desc);
create index if not exists support_conversations_queue on private.support_conversations(status, last_message_at desc);
create index if not exists support_conversations_assignee on private.support_conversations(assignee_id, status) where assignee_id is not null;

create table if not exists private.support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references private.support_conversations(id) on delete cascade,
  author_id uuid references public."user"(id) on delete set null,
  author_role text not null check (author_role in ('customer','staff','system')),
  body text not null check (length(body) between 1 and 4000),
  -- Internal notes are only ever shown to employees.
  internal boolean not null default false check (not internal or author_role = 'staff'),
  -- Set once the customer has been emailed about this staff reply.
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists support_messages_thread on private.support_messages(conversation_id, created_at);
create index if not exists support_messages_unnotified on private.support_messages(created_at)
  where author_role = 'staff' and not internal and notified_at is null;

-- Employee availability for live chat.
create table if not exists private.support_agents (
  user_id uuid primary key references public."user"(id) on delete cascade,
  available boolean not null default false,
  last_seen_at timestamptz not null default now()
);

-- Saved replies shared by the support team.
create table if not exists private.support_saved_replies (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 80),
  body text not null check (length(body) between 1 and 4000),
  created_by uuid references public."user"(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table private.support_conversations enable row level security;
alter table private.support_messages enable row level security;
alter table private.support_agents enable row level security;
alter table private.support_saved_replies enable row level security;
revoke all on private.support_conversations, private.support_messages, private.support_agents, private.support_saved_replies
  from public, anon, authenticated;
commit;
