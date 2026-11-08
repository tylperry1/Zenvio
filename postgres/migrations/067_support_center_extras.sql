begin;
-- Customer-service extras on top of the native support tickets (066):
-- topics, priority, satisfaction rating, response timing and employee
-- availability for live chat. Additive only.

alter table private.support_tickets
  add column if not exists category text not null default 'other'
    check (category in ('account','billing','bookings','documents','marketplace','technical','other')),
  add column if not exists priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  add column if not exists page text not null default '' check (length(page) <= 300),
  add column if not exists rating smallint check (rating is null or rating between 1 and 5),
  add column if not exists first_response_at timestamptz,
  add column if not exists resolved_at timestamptz;

-- Backfill timing for conversations that already exist.
update private.support_tickets t set first_response_at = (
  select min(m.created_at) from private.support_messages m where m.ticket_id = t.id and m.staff and not m.internal
) where first_response_at is null;
update private.support_tickets set resolved_at = updated_at where status = 'resolved' and resolved_at is null;

create index if not exists support_ticket_assignee on private.support_tickets(assigned_to, status) where assigned_to is not null;

-- Employees mark themselves available; customers see whether the team is online.
create table if not exists private.support_agents (
  user_id uuid primary key references public."user"(id) on delete cascade,
  available boolean not null default false,
  last_seen_at timestamptz not null default now()
);
alter table private.support_agents enable row level security;
revoke all on private.support_agents from public, anon, authenticated;
commit;
