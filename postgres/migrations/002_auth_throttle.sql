begin;
create table private.auth_attempts(key text primary key,count integer not null,window_start timestamptz not null);
revoke all on private.auth_attempts from public,anon,authenticated;
commit;
