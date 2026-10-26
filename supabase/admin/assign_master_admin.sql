-- Run in the Supabase SQL editor AFTER your owner signs up and confirms email.
-- Replace this placeholder locally; do not commit the owner's personal email.
-- This operation cannot be performed through a public API or user profile.
begin;
do $$
declare owner_email text := 'replace-with-verified-owner-email@example.com'; owner_id uuid;
begin
  if owner_email='replace-with-verified-owner-email@example.com' then raise exception 'Set the verified owner email before running this script';end if;
  select id into owner_id from auth.users
    where lower(email)=lower(trim(owner_email)) and email_confirmed_at is not null
      and (banned_until is null or banned_until<now());
  if owner_id is null then raise exception 'The owner must register and confirm their email first';end if;
  if exists(select 1 from private.platform_roles where enabled and user_id<>owner_id) then
    raise exception 'An owner already exists. Review existing roles before granting another master admin';
  end if;
  insert into private.platform_roles(user_id,role,enabled) values(owner_id,'master_admin',true)
    on conflict(user_id) do update set enabled=true;
  insert into private.admin_audit_log(actor_id,account_id,action,details)
    values(owner_id,owner_id,'master_admin_assigned',jsonb_build_object('source','database_owner_bootstrap'));
end;$$;
commit;
