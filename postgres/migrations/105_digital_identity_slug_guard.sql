begin;
-- Prevent claiming a slug that is still reserved as a prior Digital Identity address.
-- Complements application checks so concurrent creates cannot take over old QR/NFC destinations.

create or replace function private.guard_smart_profile_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from private.smart_profile_slug_redirects r
     where r.old_slug = new.slug
       and (tg_op = 'INSERT' or r.profile_id is distinct from new.id)
  ) then
    raise exception 'profile address reserved by redirect'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists smart_profiles_slug_redirect_guard on private.smart_profiles;
create trigger smart_profiles_slug_redirect_guard
  before insert or update of slug on private.smart_profiles
  for each row execute function private.guard_smart_profile_slug();

revoke all on function private.guard_smart_profile_slug() from public, anon, authenticated;
commit;
