-- Dedicated Zenvio Postgres schema. Never apply to a Supabase database.
begin;
create schema if not exists auth;
create schema if not exists private;
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 execute format('grant anon, authenticated to %I',current_user);
end $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('zenvio.user_id',true),'')::uuid $$;
grant usage on schema public,auth to anon,authenticated;
grant execute on function auth.uid() to anon,authenticated;
create table public."user" (
 id uuid primary key, name text not null, email text not null unique,
 "emailVerified" boolean not null default false, image text,
 "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now()
);
create table public.session (
 id uuid primary key, "expiresAt" timestamptz not null, token text not null unique,
 "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now(),
 "ipAddress" text, "userAgent" text, "userId" uuid not null references public."user"(id) on delete cascade
);
create index session_user_id on public.session("userId");
create table public.account (
 id uuid primary key, "accountId" text not null, "providerId" text not null,
 "userId" uuid not null references public."user"(id) on delete cascade,
 "accessToken" text, "refreshToken" text, "idToken" text,
 "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
 scope text, password text, "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now(),
 unique("providerId","accountId")
);
create index account_user_id on public.account("userId");
create table public.verification (
 id uuid primary key, identifier text not null, value text not null, "expiresAt" timestamptz not null,
 "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now()
);
create index verification_identifier on public.verification(identifier);
create table public."rateLimit" (id uuid primary key, key text unique not null,count integer not null,"lastRequest" bigint not null);
create table private.owner_bootstrap(email text primary key,claimed_at timestamptz not null default now());
revoke all on public."user",public.session,public.account,public.verification,public."rateLimit",private.owner_bootstrap from public,anon,authenticated;

create extension if not exists btree_gist ;

create table public.profiles (
 id uuid primary key references public."user"(id) on delete cascade,
 name text not null check (length(name) between 2 and 100),
 slug text not null unique check (slug <> 'demo' and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 60),
 timezone text not null default 'America/New_York', bio text not null default '' check (length(bio)<=500),
 created_at timestamptz not null default now()
);
create table public.event_types (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 title text not null check (length(title) between 1 and 100), slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 60),
 description text not null default '' check (length(description)<=1000), duration integer not null default 30 check(duration between 5 and 240),
 buffer integer not null default 15 check(buffer between 0 and 60), location text not null default 'Phone call' check(length(location) between 1 and 200),
 color text not null default '#365CFF' check(color ~ '^#[0-9a-fA-F]{6}$'), active boolean not null default true,
 created_at timestamptz not null default now(), unique(user_id,slug),unique(id,user_id)
);
create table public.availability (
 user_id uuid not null references public.profiles(id) on delete cascade,day integer not null check(day between 0 and 6),
 enabled boolean not null default true,start_time time not null default '09:00',end_time time not null default '17:00',
 primary key(user_id,day),check(start_time<end_time)
);
create table public.contacts (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,
 name text not null check(length(name) between 1 and 100),email text not null check(length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 company text not null default '' check(length(company)<=100),notes text not null default '' check(length(notes)<=2000),
 created_at timestamptz not null default now(),unique(user_id,email)
);
create table public.bookings (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,
 event_id uuid not null,guest_name text not null check(length(guest_name) between 2 and 100),
 guest_email text not null check(length(guest_email)<=254 and guest_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 notes text not null default '' check(length(notes)<=2000),starts_at timestamptz not null,ends_at timestamptz not null,
 blocked_until timestamptz not null,status text not null default 'confirmed' check(status in ('confirmed','cancelled')),
 cancel_token uuid not null unique default gen_random_uuid(),created_at timestamptz not null default now(),
 check(ends_at>starts_at),check(blocked_until>=ends_at),foreign key(event_id,user_id) references public.event_types(id,user_id),
 exclude using gist(user_id with =, tstzrange(starts_at,blocked_until,'[)') with &&) where (status='confirmed')
);
create index bookings_user_time on public.bookings(user_id,starts_at);
create index event_types_owner on public.event_types(user_id);
create index contacts_owner on public.contacts(user_id);

alter table public.profiles enable row level security;
alter table public.event_types enable row level security;
alter table public.availability enable row level security;
alter table public.contacts enable row level security;
alter table public.bookings enable row level security;
create policy profiles_own_select on public.profiles for select to authenticated using(id=(select auth.uid()));
create policy profiles_own_update on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
create policy events_own on public.event_types for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy availability_own on public.availability for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy contacts_own on public.contacts for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy bookings_own_select on public.bookings for select to authenticated using(user_id=(select auth.uid()));
create policy bookings_own_update on public.bookings for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
revoke all on public.profiles,public.event_types,public.availability,public.contacts,public.bookings from anon,authenticated;
grant select on public.profiles to authenticated;
grant update(name,slug,timezone,bio) on public.profiles to authenticated;
grant select,insert,update,delete on public.event_types,public.availability,public.contacts to authenticated;
grant select on public.bookings to authenticated;
grant update(status) on public.bookings to authenticated;

create function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,name,slug) values(new.id,left(coalesce(nullif(new.name,''),'My workspace'),100),'host-'||replace(new.id::text,'-',''));
 insert into public.availability(user_id,day,enabled) select new.id,d,d between 1 and 5 from generate_series(0,6)d;
 insert into public.event_types(user_id,title,slug,description,duration,location) values(new.id,'Discovery call','discovery-call','A little time to connect, talk through your goals, and see how we can help.',30,'Phone call');
 return new;
end;$$;
revoke all on function public.handle_new_user() from public,anon,authenticated;
create trigger on_auth_user_created after insert on public."user" for each row execute procedure public.handle_new_user();

create function public.validate_timezone() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from pg_timezone_names where name=new.timezone) then raise exception 'invalid_timezone';end if;
 return new;
end;$$;
revoke all on function public.validate_timezone() from public,anon,authenticated;
create trigger profile_timezone before insert or update of timezone on public.profiles for each row execute procedure public.validate_timezone();

-- Public access is limited to these functions; no public table reads.
create function public.public_event(host_slug text,event_slug text)
returns table(host text,host_address text,timezone text,bio text,title text,description text,duration integer,location text,color text)
language sql stable security definer set search_path='' as $$
 select p.name,p.slug,p.timezone,p.bio,e.title,e.description,e.duration,e.location,e.color
 from public.profiles p join public.event_types e on e.user_id=p.id where p.slug=$1 and e.slug=$2 and e.active;
$$;
create function public.public_slots(host_slug text,event_slug text,day_date date)
returns table(starts_at timestamptz) language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid; tz text; minutes integer; gap integer; opening time; closing time;
begin
 select p.id,p.timezone,e.duration,e.buffer into owner_id,tz,minutes,gap from public.profiles p join public.event_types e on e.user_id=p.id where p.slug=$1 and e.slug=$2 and e.active;
 if owner_id is null then return;end if;
 if day_date<(now() at time zone tz)::date or day_date>(now() at time zone tz)::date+90 then return;end if;
 select a.start_time,a.end_time into opening,closing from public.availability a where a.user_id=owner_id and a.day=extract(dow from day_date)::integer and a.enabled;
 if opening is null then return;end if;
 return query select s.slot from generate_series((day_date+opening) at time zone tz,((day_date+closing) at time zone tz)-make_interval(mins=>minutes),interval '15 minutes')s(slot)
 where s.slot>=now()+interval '2 hours' and not exists(select 1 from public.bookings b where b.user_id=owner_id and b.status='confirmed' and tstzrange(s.slot,s.slot+make_interval(mins=>minutes+gap),'[)')&&tstzrange(b.starts_at,b.blocked_until,'[)'));
end;$$;
create function public.reserve_booking(host_slug text,event_slug text,slot_start timestamptz,visitor_name text,visitor_email text,visitor_notes text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid; tz text; event_row public.event_types; booking_row public.bookings;
begin
 if length(visitor_name) not between 2 and 100 or length(visitor_email)>254 or visitor_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(visitor_notes)>2000 then raise exception 'invalid_details';end if;
 select p.id,p.timezone into owner_id,tz from public.profiles p where p.slug=$1;
 if owner_id is null then raise exception 'not_found';end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 select * into event_row from public.event_types e where e.user_id=owner_id and e.slug=$2 and e.active for share;
 if event_row.id is null then raise exception 'not_found';end if;
 -- Limit repeat reservations for a host/email, including cancelled attempts.
 if (select count(*) from public.bookings b where b.user_id=owner_id and b.guest_email=lower(trim(visitor_email)) and b.created_at>now()-interval '1 hour')>=5 then raise exception 'rate_limit';end if;
 if not exists(select 1 from public.public_slots($1,$2,(slot_start at time zone tz)::date)s where s.starts_at=slot_start) then raise exception 'slot_unavailable';end if;
 insert into public.bookings(user_id,event_id,guest_name,guest_email,notes,starts_at,ends_at,blocked_until)
 values(owner_id,event_row.id,trim(visitor_name),lower(trim(visitor_email)),visitor_notes,slot_start,slot_start+make_interval(mins=>event_row.duration),slot_start+make_interval(mins=>event_row.duration+event_row.buffer)) returning * into booking_row;
 insert into public.contacts(user_id,name,email) values(owner_id,trim(visitor_name),lower(trim(visitor_email))) on conflict(user_id,email) do nothing;
 return jsonb_build_object('id',booking_row.id,'cancel_token',booking_row.cancel_token,'starts_at',booking_row.starts_at,'ends_at',booking_row.ends_at,'title',event_row.title,'location',event_row.location);
end;$$;
create function public.cancel_booking(cancellation_token uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.bookings set status='cancelled' where cancel_token=$1 and starts_at>now();
 if not found then raise exception 'not_found';end if;
end;$$;
revoke all on function public.public_event(text,text),public.public_slots(text,text,date),public.reserve_booking(text,text,timestamptz,text,text,text),public.cancel_booking(uuid) from public;
grant execute on function public.public_event(text,text),public.public_slots(text,text,date),public.reserve_booking(text,text,timestamptz,text,text,text),public.cancel_booking(uuid) to anon,authenticated;

-- Platform privileges are separate from user-editable profile/auth metadata.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.platform_roles (
  user_id uuid primary key references public."user"(id) on delete cascade,
  role text not null default 'master_admin' check (role='master_admin'),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create table private.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public."user"(id) on delete set null,
  account_id uuid references public."user"(id) on delete set null,
  event_id uuid,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index admin_audit_time on private.admin_audit_log(created_at desc);
alter table private.platform_roles enable row level security;
alter table private.admin_audit_log enable row level security;
revoke all on private.platform_roles,private.admin_audit_log from public,anon,authenticated;

create function public.current_platform_role() returns text
language sql stable security definer set search_path='' as $$
  select case when exists (
    select 1 from private.platform_roles r join public."user" u on u.id=r.user_id
    where r.user_id=(select auth.uid()) and r.enabled
      and u."emailVerified"
      
  ) then 'master_admin' else 'member' end;
$$;
revoke all on function public.current_platform_role() from public,anon;
grant execute on function public.current_platform_role() to authenticated;

create function public.admin_overview(page_number integer default 0,search_query text default '',page_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; total_count bigint;
begin
  if (select public.current_platform_role()) <> 'master_admin' then
    raise exception 'admin_required' using errcode='42501';
  end if;
  if page_number is null or page_number<0 or page_number>100000 or page_size is null or page_size<1 or page_size>100 or length(search_query)>100 then
    raise exception 'invalid_pagination';
  end if;
  select count(*) into total_count from public."user" u join public.profiles p on p.id=u.id
    where position(lower(coalesce(search_query,'')) in lower(p.name||' '||coalesce(u.email,'')||' '||p.slug))>0;
  select jsonb_agg(to_jsonb(accounts)) into result from (
    select p.id,p.name,p.slug,p.timezone,p.created_at,u.email,case when u."emailVerified" then u."createdAt" end as email_confirmed_at,(select max(s."createdAt") from public.session s where s."userId"=u.id) as last_sign_in_at,
      case when r.enabled then r.role else 'member' end as role,
      (select count(*) from public.event_types e where e.user_id=p.id) as event_count,
      (select count(*) from public.event_types e where e.user_id=p.id and e.active) as active_event_count,
      (select count(*) from public.bookings b where b.user_id=p.id) as booking_count
    from public.profiles p join public."user" u on u.id=p.id
    left join private.platform_roles r on r.user_id=p.id
    where position(lower(coalesce(search_query,'')) in lower(p.name||' '||coalesce(u.email,'')||' '||p.slug))>0
    order by p.created_at desc,p.id limit page_size offset page_number*page_size
  ) accounts;
  return jsonb_build_object('accounts',coalesce(result,'[]'::jsonb),'total',total_count,'page',page_number,'page_size',page_size,
    'totals',jsonb_build_object(
      'accounts',(select count(*) from public.profiles),
      'verified_accounts',(select count(*) from public."user" u join public.profiles p on p.id=u.id where u."emailVerified"),
      'active_events',(select count(*) from public.event_types where active),
      'upcoming_bookings',(select count(*) from public.bookings where status='confirmed' and starts_at>now()),
      'bookings',(select count(*) from public.bookings),
      'contacts',(select count(*) from public.contacts)));
end;$$;

create function public.admin_account_detail(account_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if (select public.current_platform_role())<>'master_admin' then raise exception 'admin_required' using errcode='42501';end if;
  select jsonb_build_object('id',p.id,'name',p.name,'email',u.email,'slug',p.slug,'timezone',p.timezone,'created_at',p.created_at,
    'email_confirmed_at',case when u."emailVerified" then u."createdAt" end,'last_sign_in_at',(select max(s."createdAt") from public.session s where s."userId"=u.id),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'slug',e.slug,'duration',e.duration,'active',e.active) order by e.created_at) from public.event_types e where e.user_id=p.id),'[]'::jsonb),
    'booking_count',(select count(*) from public.bookings b where b.user_id=p.id),
    'contact_count',(select count(*) from public.contacts c where c.user_id=p.id)) into result
    from public.profiles p join public."user" u on u.id=p.id where p.id=account_id;
  if result is null then raise exception 'not_found';end if;
  return result;
end;$$;

create function public.admin_event_status(target_event uuid,enabled boolean,reason text) returns void
language plpgsql security definer set search_path='' as $$
declare event_owner uuid; event_title text; previous boolean;
begin
  if (select public.current_platform_role())<>'master_admin' then raise exception 'admin_required' using errcode='42501';end if;
  if enabled is null or reason is null or length(trim(reason)) not between 5 and 500 then raise exception 'invalid_details';end if;
  select user_id,title,active into event_owner,event_title,previous from public.event_types where id=target_event for update;
  if not found then raise exception 'not_found';end if;
  if previous=enabled then return;end if;
  update public.event_types set active=enabled where id=target_event;
  insert into private.admin_audit_log(actor_id,account_id,event_id,action,details)
    values((select auth.uid()),event_owner,target_event,case when enabled then 'event_resumed' else 'event_paused' end,
      jsonb_build_object('title',event_title,'reason',trim(reason),'previous',previous,'active',enabled));
end;$$;

create function public.admin_audit(page_number integer default 0,page_size integer default 25) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare entries jsonb;
begin
  if (select public.current_platform_role())<>'master_admin' then raise exception 'admin_required' using errcode='42501';end if;
  if page_number is null or page_number<0 or page_number>100000 or page_size is null or page_size<1 or page_size>100 then raise exception 'invalid_pagination';end if;
  select jsonb_agg(to_jsonb(logs)) into entries from (
    select a.id,a.action,a.details,a.created_at,p.name as account_name,actor.email as actor_email
    from private.admin_audit_log a left join public.profiles p on p.id=a.account_id left join public."user" actor on actor.id=a.actor_id
    order by a.created_at desc,a.id limit page_size offset page_number*page_size
  ) logs;
  return jsonb_build_object('entries',coalesce(entries,'[]'::jsonb),'total',(select count(*) from private.admin_audit_log),'page',page_number,'page_size',page_size);
end;$$;
revoke all on function public.admin_overview(integer,text,integer),public.admin_account_detail(uuid),public.admin_event_status(uuid,boolean,text),public.admin_audit(integer,integer) from public,anon;
grant execute on function public.admin_overview(integer,text,integer),public.admin_account_detail(uuid),public.admin_event_status(uuid,boolean,text),public.admin_audit(integer,integer) to authenticated;
-- Non-sensitive readiness marker; account forms wait for the complete schema.
create function public.account_schema_version() returns integer language sql immutable set search_path='' as $$ select 4; $$;
revoke all on function public.account_schema_version() from public;
grant execute on function public.account_schema_version() to anon,authenticated;


commit;
