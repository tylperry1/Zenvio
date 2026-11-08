begin;
create table private.support_tickets (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public."user"(id) on delete cascade,
 subject text not null check(length(subject) between 1 and 150),
 status text not null default 'open' check(status in ('open','pending','resolved')),
 assigned_to uuid references public."user"(id) on delete set null,
 customer_read bigint not null default 0,
 staff_read bigint not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index support_ticket_owner on private.support_tickets(user_id,updated_at desc);
create index support_ticket_queue on private.support_tickets(status,updated_at desc);
create table private.support_messages (
 id bigint generated always as identity primary key,
 ticket_id uuid not null references private.support_tickets(id) on delete cascade,
 sender_id uuid references public."user"(id) on delete set null,
 staff boolean not null,
 internal boolean not null default false,
 content text not null check(length(content) between 1 and 4000),
 reference uuid not null unique,
 created_at timestamptz not null default now(),
 check(not internal or staff)
);
create index support_message_history on private.support_messages(ticket_id,id);
create table private.support_replies (
 id uuid primary key default gen_random_uuid(),
 title text not null check(length(title) between 1 and 100),
 content text not null check(length(content) between 1 and 4000)
);
alter table private.support_tickets enable row level security;
alter table private.support_messages enable row level security;
alter table private.support_replies enable row level security;
revoke all on private.support_tickets,private.support_messages,private.support_replies from public,anon,authenticated;
commit;
