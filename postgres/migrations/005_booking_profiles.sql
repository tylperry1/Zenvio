begin;
alter table public.profiles add column headline text not null default '' check(length(headline)<=120),
 add column company text not null default '' check(length(company)<=80),
 add column accent_color text not null default '#365CFF' check(accent_color ~ '^#[0-9a-fA-F]{6}$');
grant update(headline,company,accent_color) on public.profiles to authenticated;
alter table public.event_types add column deleted_at timestamptz;
alter table public.event_types add constraint deleted_event_inactive check(deleted_at is null or not active);
alter table public.event_types drop constraint event_types_user_id_slug_key;
create unique index event_types_live_slug on public.event_types(user_id,slug) where deleted_at is null;
revoke delete on public.event_types from authenticated;
drop policy events_own on public.event_types;
create policy events_own_select on public.event_types for select to authenticated using(user_id=(select auth.uid()));
create policy events_own_insert on public.event_types for insert to authenticated with check(user_id=(select auth.uid()) and deleted_at is null);
create policy events_own_update on public.event_types for update to authenticated using(user_id=(select auth.uid()) and deleted_at is null) with check(user_id=(select auth.uid()) and deleted_at is null);

create function public.public_profile(host_slug text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('profile',jsonb_build_object('name',p.name,'slug',p.slug,'timezone',p.timezone,'bio',p.bio,'headline',p.headline,'company',p.company,'accent_color',p.accent_color),
 'events',coalesce((select jsonb_agg(jsonb_build_object('slug',e.slug,'title',e.title,'description',e.description,'duration',e.duration,'location',e.location,'color',e.color) order by e.created_at,e.id)
 from public.event_types e where e.user_id=p.id and e.active and e.deleted_at is null),'[]'::jsonb))
 from public.profiles p where p.slug=host_slug;
$$;
revoke all on function public.public_profile(text) from public;
grant execute on function public.public_profile(text) to anon,authenticated;

create function public.delete_event_type(target_event uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid := (select auth.uid()); event_title text;
begin
 if owner_id is null then raise exception 'permission_denied' using errcode='42501';end if;
 -- Serialize deletion with reservations for this host. Already booked meetings survive.
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 select title into event_title from public.event_types where id=target_event and user_id=owner_id and deleted_at is null for update;
 if not found then raise exception 'not_found';end if;
 update public.event_types set active=false,deleted_at=now() where id=target_event and user_id=owner_id;
 return jsonb_build_object('title',event_title);
end;$$;
revoke all on function public.delete_event_type(uuid) from public,anon;
grant execute on function public.delete_event_type(uuid) to authenticated;

create or replace function public.admin_overview(page_number integer default 0,search_query text default '',page_size integer default 25)
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
      (select count(*) from public.event_types e where e.user_id=p.id and e.deleted_at is null) as event_count,
      (select count(*) from public.event_types e where e.user_id=p.id and e.deleted_at is null and e.active) as active_event_count,
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
      'active_events',(select count(*) from public.event_types where active and deleted_at is null),
      'upcoming_bookings',(select count(*) from public.bookings where status='confirmed' and starts_at>now()),
      'bookings',(select count(*) from public.bookings),
      'contacts',(select count(*) from public.contacts)));
end;$$;

create or replace function public.admin_account_detail(account_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if (select public.current_platform_role())<>'master_admin' then raise exception 'admin_required' using errcode='42501';end if;
  select jsonb_build_object('id',p.id,'name',p.name,'email',u.email,'slug',p.slug,'timezone',p.timezone,'created_at',p.created_at,
    'email_confirmed_at',case when u."emailVerified" then u."createdAt" end,'last_sign_in_at',(select max(s."createdAt") from public.session s where s."userId"=u.id),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'slug',e.slug,'duration',e.duration,'active',e.active) order by e.created_at) from public.event_types e where e.user_id=p.id and e.deleted_at is null),'[]'::jsonb),
    'booking_count',(select count(*) from public.bookings b where b.user_id=p.id),
    'contact_count',(select count(*) from public.contacts c where c.user_id=p.id)) into result
    from public.profiles p join public."user" u on u.id=p.id where p.id=account_id;
  if result is null then raise exception 'not_found';end if;
  return result;
end;$$;

create or replace function public.admin_event_status(target_event uuid,enabled boolean,reason text) returns void
language plpgsql security definer set search_path='' as $$
declare event_owner uuid; event_title text; previous boolean;
begin
  if (select public.current_platform_role())<>'master_admin' then raise exception 'admin_required' using errcode='42501';end if;
  if enabled is null or reason is null or length(trim(reason)) not between 5 and 500 then raise exception 'invalid_details';end if;
  select user_id,title,active into event_owner,event_title,previous from public.event_types where id=target_event and deleted_at is null for update;
  if not found then raise exception 'not_found';end if;
  if previous=enabled then return;end if;
  update public.event_types set active=enabled where id=target_event;
  insert into private.admin_audit_log(actor_id,account_id,event_id,action,details)
    values((select auth.uid()),event_owner,target_event,case when enabled then 'event_resumed' else 'event_paused' end,
      jsonb_build_object('title',event_title,'reason',trim(reason),'previous',previous,'active',enabled));
end;$$;
create or replace function public.admin_insights() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare daily jsonb; today date := (now() at time zone 'UTC')::date;
begin
 if (select public.current_platform_role())<>'master_admin' then raise exception 'admin_required' using errcode='42501';end if;
 select jsonb_agg(jsonb_build_object('day',d.bucket::date,'bookings',coalesce(b.total,0),'accounts',coalesce(a.total,0)) order by d.bucket)
 into daily from generate_series(today-13,today,interval '1 day') d(bucket)
 left join (select (created_at at time zone 'UTC')::date as bucket,count(*) total from public.bookings where created_at>=((today-13)::timestamp at time zone 'UTC') group by 1) b on b.bucket=d.bucket::date
 left join (select (created_at at time zone 'UTC')::date as bucket,count(*) total from public.profiles where created_at>=((today-13)::timestamp at time zone 'UTC') group by 1) a on a.bucket=d.bucket::date;
 return jsonb_build_object('daily',coalesce(daily,'[]'::jsonb),'generated_at',now(),
 'metrics',jsonb_build_object(
  'new_accounts_30d',(select count(*) from public.profiles where created_at>=now()-interval '30 days'),
  'confirmed_bookings',(select count(*) from public.bookings where status='confirmed'),
  'cancelled_bookings',(select count(*) from public.bookings where status='cancelled'),
  'events',(select count(*) from public.event_types where deleted_at is null),
  'paused_events',(select count(*) from public.event_types where not active and deleted_at is null),
  'upcoming_7d',(select count(*) from public.bookings where status='confirmed' and starts_at>=now() and starts_at<now()+interval '7 days')
 ));
end;$$;
commit;
