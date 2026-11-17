-- Unified notification orchestration envelopes. Channel transports reuse
-- private.delivery_jobs (Resend) and private.sms_outbox (Telnyx); push is stubbed
-- for a future Firebase adapter. Does not activate SMS sending.

BEGIN;

CREATE TABLE private.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,
  email_transactional boolean NOT NULL DEFAULT true,
  email_marketing boolean NOT NULL DEFAULT false,
  sms_appointment boolean NOT NULL DEFAULT true,
  sms_marketing boolean NOT NULL DEFAULT false,
  push_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE private.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  recipient_user_id uuid REFERENCES public."user"(id) ON DELETE SET NULL,
  recipient_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  recipient_address text NOT NULL DEFAULT '',
  category text NOT NULL CHECK (category IN (
    'appointment_confirmation',
    'appointment_reminder',
    'appointment_reschedule',
    'appointment_cancellation',
    'customer_message',
    'payment',
    'document',
    'security',
    'marketing',
    'admin_alert',
    'other'
  )),
  template_id text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'scheduled', 'processing', 'accepted', 'delivered', 'failed', 'canceled', 'suppressed'
  )),
  idempotency_key text NOT NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  booking_revision integer,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, idempotency_key),
  -- Revision is required while a booking is linked. ON DELETE SET NULL may leave
  -- booking_revision populated after the booking row is removed; that is intentional
  -- audit history and must not fail the booking delete.
  CONSTRAINT notifications_booking_revision_pair CHECK (
    booking_id IS NULL OR booking_revision IS NOT NULL
  )
);

CREATE INDEX notifications_workspace_created_idx
  ON private.notifications (workspace_id, created_at DESC);
CREATE INDEX notifications_booking_idx
  ON private.notifications (booking_id)
  WHERE booking_id IS NOT NULL;
CREATE INDEX notifications_due_idx
  ON private.notifications (scheduled_at)
  WHERE status IN ('queued', 'scheduled');

CREATE TABLE private.notification_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES private.notifications(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'push')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'scheduled', 'processing', 'accepted', 'delivered', 'failed', 'canceled', 'suppressed'
  )),
  provider text CHECK (provider IS NULL OR provider IN ('resend', 'telnyx', 'twilio', 'firebase')),
  provider_reference text,
  delivery_job_dedupe_key text,
  sms_outbox_reference text,
  failure_reason text,
  failure_class text CHECK (
    failure_class IS NULL OR failure_class IN (
      'transient',
      'permanent',
      'consent',
      'preference',
      'provider_disabled',
      'not_implemented',
      'suppressed',
      'invalid_recipient'
    )
  ),
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  accepted_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, channel)
);

CREATE INDEX notification_attempts_workspace_idx
  ON private.notification_attempts (workspace_id, created_at DESC);
CREATE INDEX notification_attempts_status_idx
  ON private.notification_attempts (status, created_at)
  WHERE status IN ('queued', 'scheduled', 'processing', 'failed');

ALTER TABLE private.delivery_jobs
  ADD COLUMN notification_attempt_id uuid
    REFERENCES private.notification_attempts(id) ON DELETE SET NULL;

CREATE INDEX delivery_jobs_notification_attempt_idx
  ON private.delivery_jobs (notification_attempt_id)
  WHERE notification_attempt_id IS NOT NULL;

-- Cancel open notification envelopes when a booking revises or cancels
-- (mirrors existing delivery_jobs cancellation in private.lifecycle_booking).
CREATE OR REPLACE FUNCTION private.lifecycle_booking() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.starts_at, NEW.ends_at, NEW.status) IS DISTINCT FROM (OLD.starts_at, OLD.ends_at, OLD.status) THEN
    NEW.revision := OLD.revision + 1;
    INSERT INTO private.booking_activity(booking_id, action, details)
    VALUES (
      OLD.id,
      CASE WHEN NEW.status = 'cancelled' THEN 'cancelled' ELSE 'rescheduled' END,
      jsonb_build_object('previousStart', OLD.starts_at, 'newStart', NEW.starts_at)
    );
    UPDATE private.delivery_jobs
      SET status = 'cancelled', payload_ciphertext = NULL
      WHERE booking_id = OLD.id AND status = 'queued';
    UPDATE private.notification_attempts a
      SET status = 'canceled', updated_at = now(),
          failure_reason = coalesce(a.failure_reason, 'Booking revised or cancelled.'),
          failure_class = coalesce(a.failure_class, 'suppressed')
      FROM private.notifications n
      WHERE a.notification_id = n.id
        AND n.booking_id = OLD.id
        AND a.status IN ('queued', 'scheduled', 'processing')
        AND NOT EXISTS (
          SELECT 1 FROM private.delivery_jobs j
           WHERE j.notification_attempt_id = a.id AND j.status IN ('sent', 'uncertain')
        );
    UPDATE private.notifications
      SET status = 'canceled', updated_at = now()
      WHERE booking_id = OLD.id
        AND status IN ('queued', 'scheduled', 'processing')
        AND NOT EXISTS (
          SELECT 1 FROM private.notification_attempts a
           WHERE a.notification_id = private.notifications.id
             AND a.status IN ('accepted', 'delivered')
        );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON private.notification_preferences, private.notifications, private.notification_attempts
  FROM public, anon, authenticated;

COMMIT;
