-- Per-user inbox read state so opening a thread does not clear unread for teammates.

BEGIN;

CREATE TABLE IF NOT EXISTS private.thread_user_state (
  thread_id uuid NOT NULL REFERENCES private.message_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT 'epoch'::timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);

CREATE INDEX IF NOT EXISTS thread_user_state_user_idx
  ON private.thread_user_state (user_id, last_read_at DESC);

REVOKE ALL ON private.thread_user_state FROM public, anon, authenticated;

COMMENT ON TABLE private.thread_user_state IS
  'Per-workspace-user last-read cursor for inbox threads. Unread is derived, not shared.';

COMMIT;
