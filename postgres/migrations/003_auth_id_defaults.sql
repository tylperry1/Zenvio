begin;
-- Better Auth's Postgres UUID mode delegates ID generation to the database.
alter table public."user" alter column id set default gen_random_uuid();
alter table public.session alter column id set default gen_random_uuid();
alter table public.account alter column id set default gen_random_uuid();
alter table public.verification alter column id set default gen_random_uuid();
alter table public."rateLimit" alter column id set default gen_random_uuid();
commit;
