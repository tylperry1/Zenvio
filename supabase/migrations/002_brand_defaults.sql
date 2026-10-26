-- Presentation default for newly created event types and new accounts.
-- Existing event colors and all existing rows are preserved.
alter table public.event_types alter column color set default '#365CFF';
