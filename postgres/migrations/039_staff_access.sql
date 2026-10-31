begin;
-- Zenvio employee accounts with delegated admin-console permissions.
-- The master admin (private.platform_roles) keeps full, non-delegable control.
create table if not exists private.staff_members (
  user_id uuid primary key references public."user"(id) on delete cascade,
  title text not null default '' check (length(title) <= 80),
  permissions text[] not null default '{}',
  workspace_plan text check (workspace_plan is null or workspace_plan in ('free','pro','business','teams','individual','team')),
  enabled boolean not null default true,
  invited_by uuid references public."user"(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.staff_members enable row level security;
revoke all on private.staff_members from public, anon, authenticated;

-- Staff only gain admin privileges inside a server call that was already
-- authorized for one specific console area (zenvio.admin_scope). Outside such
-- a call they remain ordinary members.
create or replace function public.current_platform_role() returns text
language sql stable security definer set search_path='' as $$
  select case
    when exists (
      select 1 from private.platform_roles r join public."user" u on u.id=r.user_id
      where r.user_id=(select auth.uid()) and r.enabled and u."emailVerified"
    ) then 'master_admin'
    when nullif(current_setting('zenvio.admin_scope', true), '') is not null and exists (
      select 1 from private.staff_members s join public."user" u on u.id=s.user_id
      where s.user_id=(select auth.uid()) and s.enabled and u."emailVerified"
        and current_setting('zenvio.admin_scope', true) = any(s.permissions)
    ) then 'master_admin'
    else 'member' end;
$$;
revoke all on function public.current_platform_role() from public, anon;
grant execute on function public.current_platform_role() to authenticated;

create or replace function public.current_staff_access() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('title', s.title, 'permissions', to_jsonb(s.permissions))
  from private.staff_members s join public."user" u on u.id=s.user_id
  where s.user_id=(select auth.uid()) and s.enabled and u."emailVerified";
$$;
revoke all on function public.current_staff_access() from public, anon;
grant execute on function public.current_staff_access() to authenticated;

-- The master admin always has every product feature; employees receive the
-- workspace plan the master admin assigns to them.
create or replace function private.effective_plan(target uuid) returns text
language sql stable security definer set search_path='' as $$
 select coalesce(
  (select 'team' from private.platform_roles where user_id=target and enabled),
  (select workspace_plan from private.staff_members where user_id=target and enabled and workspace_plan is not null),
  (select plan from private.entitlement_overrides where user_id=target and expires_at>now()),
  case when exists(select 1 from private.team_entitlement_roots(target) r join private.subscriptions s on s.user_id=r.owner_id where s.plan='team' and s.status in ('active','trialing')) then 'team'
       when exists(select 1 from private.team_entitlement_roots(target)) then 'teams' end,
  (select plan from private.subscriptions where user_id=target and status in ('active','trialing') and (plan not in ('teams','team') or seats>=3)),
  'free');
$$;
commit;
