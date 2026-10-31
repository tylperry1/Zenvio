begin;
alter table private.growth_memberships add column cancel_at_period_end boolean not null default false;
commit;
