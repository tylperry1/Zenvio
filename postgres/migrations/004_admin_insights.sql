begin;
create function public.admin_insights() returns jsonb
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
  'events',(select count(*) from public.event_types),
  'paused_events',(select count(*) from public.event_types where not active),
  'upcoming_7d',(select count(*) from public.bookings where status='confirmed' and starts_at>=now() and starts_at<now()+interval '7 days')
 ));
end;$$;
revoke all on function public.admin_insights() from public,anon;
grant execute on function public.admin_insights() to authenticated;
commit;
