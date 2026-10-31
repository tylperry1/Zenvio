begin;
create table private.stored_files(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public."user"(id) on delete restrict,
 provider text not null check(provider='r2'),object_key text not null unique,
 filename text not null,content_type text not null,byte_size integer not null check(byte_size between 1 and 3000000),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 scan_status text not null check(scan_status in ('clean','rejected')),
 state text not null default 'pending' check(state in ('pending','stored','failed')),
 created_at timestamptz not null default now()
);
create index stored_files_owner_idx on private.stored_files(user_id,created_at desc);
revoke all on private.stored_files from public,anon,authenticated;
commit;
