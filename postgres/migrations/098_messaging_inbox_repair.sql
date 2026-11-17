-- Messaging inbox repair: conversation lifecycle, soft-delete/edit audit,
-- and indexes for authorized filters. Existing open/closed rows stay valid.

BEGIN;

-- Lifecycle: keep open/closed; add pending_response + archived.
ALTER TABLE private.message_threads
  DROP CONSTRAINT IF EXISTS message_threads_status_check;
ALTER TABLE private.message_threads
  ADD CONSTRAINT message_threads_status_check
  CHECK (status IN ('open', 'pending_response', 'closed', 'archived'));

CREATE INDEX IF NOT EXISTS message_threads_status_idx
  ON private.message_threads (user_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS message_threads_assignee_idx
  ON private.message_threads (assigned_to, last_message_at DESC)
  WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS message_threads_unassigned_idx
  ON private.message_threads (user_id, last_message_at DESC)
  WHERE assigned_to IS NULL AND status IN ('open', 'pending_response');

-- Soft delete + edit metadata on messages (delivery rows stay intact).
ALTER TABLE private.thread_messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS edited_by uuid REFERENCES public."user"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public."user"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS thread_messages_active_idx
  ON private.thread_messages (thread_id, created_at)
  WHERE deleted_at IS NULL;

-- Revision history for edits (delivered copies are never rewritten remotely).
CREATE TABLE IF NOT EXISTS private.thread_message_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES private.thread_messages(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES private.message_threads(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  edited_by uuid REFERENCES public."user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS thread_message_revisions_message_idx
  ON private.thread_message_revisions (message_id, created_at DESC);

-- Conversation audit (assign/status/read/edit/delete).
CREATE TABLE IF NOT EXISTS private.thread_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES private.message_threads(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public."user"(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 64),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS thread_activity_thread_idx
  ON private.thread_activity (thread_id, created_at DESC);

REVOKE ALL ON private.thread_message_revisions, private.thread_activity
  FROM public, anon, authenticated;

COMMENT ON COLUMN private.thread_messages.deleted_at IS
  'Soft-delete timestamp; portal and customer views must exclude deleted rows.';
COMMENT ON TABLE private.thread_message_revisions IS
  'Prior message bodies after host edits. Does not alter provider-delivered copies.';

COMMIT;
