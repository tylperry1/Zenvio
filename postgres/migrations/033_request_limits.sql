begin;
-- Fixed-window counters for public, unauthenticated endpoints (keys are hashed).
create table if not exists private.request_limits(
  key text primary key,
  count integer not null,
  window_start timestamptz not null
);
create index if not exists request_limits_window_idx on private.request_limits(window_start);
revoke all on private.request_limits from public,anon,authenticated;
commit;
