-- Platform privileges are separate from user-editable profile/auth metadata.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.platform_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'master_admin' check (role='master_admin'),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create table private.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  account_id uuid references auth.users(id) on delete set null,
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
    select 1 from private.platform_roles r join auth.users u on u.id=r.user_id
    where r.user_id=(select auth.uid()) and r.enabled
      and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until<now())
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
  select count(*) into total_count from auth.users u join public.profiles p on p.id=u.id
    where position(lower(coalesce(search_query,'')) in lower(p.name||' '||coalesce(u.email,'')||' '||p.slug))>0;
  select jsonb_agg(to_jsonb(accounts)) into result from (
    select p.id,p.name,p.slug,p.timezone,p.created_at,u.email,u.email_confirmed_at,u.last_sign_in_at,
      case when r.enabled then r.role else 'member' end as role,
      (select count(*) from public.event_types e where e.user_id=p.id) as event_count,
      (select count(*) from public.event_types e where e.user_id=p.id and e.active) as active_event_count,
      (select count(*) from public.bookings b where b.user_id=p.id) as booking_count
    from public.profiles p join auth.users u on u.id=p.id
    left join private.platform_roles r on r.user_id=p.id
    where position(lower(coalesce(search_query,'')) in lower(p.name||' '||coalesce(u.email,'')||' '||p.slug))>0
    order by p.created_at desc,p.id limit page_size offset page_number*page_size
  ) accounts;
  return jsonb_build_object('accounts',coalesce(result,'[]'::jsonb),'total',total_count,'page',page_number,'page_size',page_size,
    'totals',jsonb_build_object(
      'accounts',(select count(*) from public.profiles),
      'verified_accounts',(select count(*) from auth.users u join public.profiles p on p.id=u.id where u.email_confirmed_at is not null),
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
    'email_confirmed_at',u.email_confirmed_at,'last_sign_in_at',u.last_sign_in_at,
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'slug',e.slug,'duration',e.duration,'active',e.active) order by e.created_at) from public.event_types e where e.user_id=p.id),'[]'::jsonb),
    'booking_count',(select count(*) from public.bookings b where b.user_id=p.id),
    'contact_count',(select count(*) from public.contacts c where c.user_id=p.id)) into result
    from public.profiles p join auth.users u on u.id=p.id where p.id=account_id;
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
    from private.admin_audit_log a left join public.profiles p on p.id=a.account_id left join auth.users actor on actor.id=a.actor_id
    order by a.created_at desc,a.id limit page_size offset page_number*page_size
  ) logs;
  return jsonb_build_object('entries',coalesce(entries,'[]'::jsonb),'total',(select count(*) from private.admin_audit_log),'page',page_number,'page_size',page_size);
end;$$;
revoke all on function public.admin_overview(integer,text,integer),public.admin_account_detail(uuid),public.admin_event_status(uuid,boolean,text),public.admin_audit(integer,integer) from public,anon;
grant execute on function public.admin_overview(integer,text,integer),public.admin_account_detail(uuid),public.admin_event_status(uuid,boolean,text),public.admin_audit(integer,integer) to authenticated;
-- Non-sensitive readiness marker; account forms wait for the complete schema.
create function public.account_schema_version() returns integer language sql immutable set search_path='' as $$ select 3; $$;
revoke all on function public.account_schema_version() from public;
grant execute on function public.account_schema_version() to anon,authenticated;
commit;
