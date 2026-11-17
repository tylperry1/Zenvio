-- Durable platform coupon catalog + sync status, and v4 entitlement guards.
-- Additive only. Does not reprice or migrate existing subscriptions.
-- Contact / paid-booking / storage guards apply to catalog_version 2026-11-v4 only
-- (legacy and 2026-11-v3 grandfathered paths are unchanged except storage already covers v3).

CREATE TABLE IF NOT EXISTS private.billing_coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL DEFAULT '',
  discount_type text NOT NULL CHECK (discount_type IN ('percent', 'amount')),
  percent_off integer CHECK (percent_off IS NULL OR (percent_off BETWEEN 1 AND 100)),
  amount_off_cents integer CHECK (amount_off_cents IS NULL OR (amount_off_cents BETWEEN 1 AND 100000000)),
  currency text NOT NULL DEFAULT 'usd',
  duration text NOT NULL CHECK (duration IN ('once', 'repeating', 'forever')),
  duration_in_months integer CHECK (duration_in_months IS NULL OR (duration_in_months BETWEEN 1 AND 36)),
  max_redemptions integer CHECK (max_redemptions IS NULL OR (max_redemptions BETWEEN 1 AND 1000000)),
  redeem_by timestamptz,
  first_time_transaction boolean NOT NULL DEFAULT false,
  applies_to_products text[] NOT NULL DEFAULT '{}',
  catalog_targets text[] NOT NULL DEFAULT '{v3}' CHECK (catalog_targets <@ ARRAY['v3','v4']::text[]),
  active boolean NOT NULL DEFAULT true,
  sync_status text NOT NULL DEFAULT 'pending'
    CHECK (sync_status IN ('synced','pending','failed','disabled')),
  sync_error text,
  stripe_coupon_id text,
  stripe_promotion_code_id text,
  times_redeemed integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public."user"(id),
  updated_by uuid REFERENCES public."user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz,
  CONSTRAINT billing_coupons_discount_shape CHECK (
    (discount_type = 'percent' AND percent_off IS NOT NULL AND amount_off_cents IS NULL)
    OR (discount_type = 'amount' AND amount_off_cents IS NOT NULL AND percent_off IS NULL)
  ),
  CONSTRAINT billing_coupons_duration_shape CHECK (
    (duration = 'repeating' AND duration_in_months IS NOT NULL)
    OR (duration IN ('once','forever') AND duration_in_months IS NULL)
  ),
  CONSTRAINT billing_coupons_code_format CHECK (code ~ '^[A-Za-z0-9_-]{3,40}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_coupons_code_unique
  ON private.billing_coupons (lower(code));
CREATE INDEX IF NOT EXISTS billing_coupons_sync_status
  ON private.billing_coupons (sync_status, updated_at DESC);
REVOKE ALL ON private.billing_coupons FROM public, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.billing_coupon_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid REFERENCES private.billing_coupons(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES public."user"(id),
  action text NOT NULL,
  before_state jsonb,
  after_state jsonb,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_coupon_audit_coupon
  ON private.billing_coupon_audit (coupon_id, created_at DESC);
REVOKE ALL ON private.billing_coupon_audit FROM public, anon, authenticated;

-- Contact capacity for v4 workspaces (legacy/v3 unchanged / grandfathered).
CREATE OR REPLACE FUNCTION private.v4_contact_allowance(plan_id text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE plan_id
    WHEN 'free' THEN 100
    WHEN 'starter' THEN 1000
    WHEN 'professional' THEN 10000
    WHEN 'business' THEN 30000
    WHEN 'enterprise' THEN NULL
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION private.guard_contact_capacity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  owner uuid;
  version text;
  plan_id text;
  state text;
  cap integer;
  used integer;
BEGIN
  SELECT coalesce(
    (SELECT owner_id FROM private.team_entitlement_roots(NEW.user_id)
      ORDER BY (owner_id = NEW.user_id) DESC, owner_id LIMIT 1),
    NEW.user_id
  ) INTO owner;

  SELECT catalog_version, plan, status
    INTO version, plan_id, state
    FROM private.subscriptions WHERE user_id = owner;

  -- Only enforce for activated v4 catalog accounts. Legacy / v3 / missing rows stay grandfathered.
  IF version IS DISTINCT FROM '2026-11-v4'
     AND (version IS NULL OR NOT version LIKE '2026-11-v4%') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM private.platform_roles WHERE user_id = owner AND enabled) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.entitlement_overrides
     WHERE user_id = owner AND expires_at > now()
  ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.user_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('entitlements:' || owner::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('contacts:' || owner::text, 0));

  IF state IS NULL OR state NOT IN ('active', 'trialing') THEN
    plan_id := 'free';
  END IF;

  cap := private.v4_contact_allowance(plan_id);
  IF cap IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*)::int INTO used
    FROM public.contacts c
    WHERE c.user_id IN (
      SELECT owner
      UNION
      SELECT m.user_id
        FROM private.memberships m
        JOIN private.organizations o ON o.id = m.organization_id
       WHERE o.owner_id = owner AND m.active
    );

  IF used >= cap THEN
    RAISE EXCEPTION 'contact_allowance_reached'
      USING ERRCODE = 'P0001',
            MESSAGE = format('Your plan allows %s CRM contacts. Review Plan & billing to upgrade.', cap);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_contact_capacity ON public.contacts;
CREATE TRIGGER guard_contact_capacity
  BEFORE INSERT ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION private.guard_contact_capacity();

REVOKE ALL ON FUNCTION private.v4_contact_allowance(text), private.guard_contact_capacity()
  FROM public, anon, authenticated;

-- Extend storage quotas to v4 catalog versions (v3 behavior preserved).
CREATE OR REPLACE FUNCTION private.guard_workspace_storage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  host uuid; owner uuid; current_owner uuid;
  old_bytes bigint := 0; new_bytes bigint := 0; cap bigint;
  version text; plan_id text; state text; lock_id uuid;
  enforce boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'design_proofs' THEN
    SELECT user_id INTO host FROM private.saved_designs WHERE id = NEW.design_id;
  ELSIF TG_TABLE_NAME = 'message_attachments' THEN
    SELECT user_id INTO host FROM private.message_threads WHERE id = NEW.thread_id;
  ELSIF TG_TABLE_NAME = 'pdf_template_versions' THEN
    SELECT user_id INTO host FROM private.pdf_templates WHERE id = NEW.template_id;
  ELSIF TG_TABLE_NAME = 'signature_recipients' THEN
    SELECT user_id INTO host FROM private.signature_envelopes WHERE id = NEW.envelope_id;
  ELSE
    host := (to_jsonb(NEW)->>'user_id')::uuid;
  END IF;
  IF host IS NULL THEN RETURN NEW; END IF;

  SELECT coalesce(
    (SELECT owner_id FROM private.team_entitlement_roots(host)
      ORDER BY (owner_id = host) DESC, owner_id LIMIT 1),
    host
  ) INTO owner;

  SELECT catalog_version, plan, status INTO version, plan_id, state
    FROM private.subscriptions WHERE user_id = owner;

  -- Match 077: enforce v3, published release-* overlays, and v4 catalogs.
  enforce := version = '2026-11-v3'
    OR version = '2026-11-v4'
    OR (version IS NOT NULL AND version LIKE '2026-11-v4%')
    OR (version IS NOT NULL AND version LIKE 'release-%');

  IF NOT enforce
     OR EXISTS (SELECT 1 FROM private.platform_roles WHERE user_id = owner AND enabled)
     OR EXISTS (SELECT 1 FROM private.entitlement_overrides WHERE user_id = owner AND expires_at > now())
  THEN
    RETURN NEW;
  END IF;

  FOR lock_id IN SELECT DISTINCT id FROM unnest(ARRAY[host, owner]) id ORDER BY id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('entitlements:' || lock_id::text, 0));
  END LOOP;

  SELECT coalesce(
    (SELECT owner_id FROM private.team_entitlement_roots(host)
      ORDER BY (owner_id = host) DESC, owner_id LIMIT 1),
    host
  ) INTO current_owner;
  IF current_owner <> owner THEN RAISE EXCEPTION 'storage_workspace_changed'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('storage:' || owner::text, 0));

  SELECT catalog_version, plan, status INTO version, plan_id, state
    FROM private.subscriptions WHERE user_id = owner;

  IF TG_TABLE_NAME IN ('profile_photos','profile_images','marketplace_artwork','brand_assets') THEN
    new_bytes := coalesce(octet_length(NEW.image), 0);
    IF TG_OP = 'UPDATE' THEN old_bytes := coalesce(octet_length(OLD.image), 0); END IF;
  ELSIF TG_TABLE_NAME IN ('intake_uploads','message_attachments') THEN
    new_bytes := octet_length(NEW.data);
    IF TG_OP = 'UPDATE' THEN old_bytes := octet_length(OLD.data); END IF;
  ELSIF TG_TABLE_NAME = 'signature_envelopes' THEN
    new_bytes := octet_length(NEW.pdf) + coalesce(octet_length(NEW.completed_pdf), 0);
    IF TG_OP = 'UPDATE' THEN
      old_bytes := octet_length(OLD.pdf) + coalesce(octet_length(OLD.completed_pdf), 0);
    END IF;
  ELSIF TG_TABLE_NAME = 'signature_recipients' THEN
    new_bytes := coalesce(octet_length(NEW.signature_image), 0);
    IF TG_OP = 'UPDATE' THEN old_bytes := coalesce(octet_length(OLD.signature_image), 0); END IF;
  ELSIF TG_TABLE_NAME = 'pdf_template_versions' THEN
    new_bytes := octet_length(NEW.pdf);
    IF TG_OP = 'UPDATE' THEN old_bytes := octet_length(OLD.pdf); END IF;
  ELSIF TG_TABLE_NAME = 'design_proofs' THEN
    new_bytes := octet_length(NEW.file);
    IF TG_OP = 'UPDATE' THEN old_bytes := octet_length(OLD.file); END IF;
  ELSIF TG_TABLE_NAME = 'stored_files' THEN
    new_bytes := NEW.byte_size;
    IF TG_OP = 'UPDATE' THEN old_bytes := OLD.byte_size; END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'signature_envelopes' THEN
    IF OLD.completed_pdf IS NULL AND NEW.completed_pdf IS NOT NULL
       AND NEW.pdf = OLD.pdf AND NEW.status = 'completed' THEN
      RETURN NEW;
    END IF;
  END IF;
  IF new_bytes <= old_bytes THEN RETURN NEW; END IF;

  -- Legacy plan id "teams" shares the current "team" catalog allowances.
  plan_id := CASE WHEN plan_id = 'teams' THEN 'team' ELSE plan_id END;

  IF version IS NOT NULL AND version LIKE 'release-%' THEN
    -- Published overlays keep their saved storageBytes allowances.
    SELECT coalesce((catalog->'allowances'->plan_id->>'storageBytes')::bigint, 0)
      INTO cap
      FROM private.billing_catalog_versions
     WHERE id = substring(version FROM 9)::uuid;
    cap := CASE WHEN state IN ('active', 'trialing') THEN coalesce(cap, 0) ELSE 0 END;
  ELSIF version = '2026-11-v3' THEN
    cap := CASE WHEN state IN ('active', 'trialing') THEN
      CASE plan_id
        WHEN 'team' THEN 10000000000
        WHEN 'individual' THEN 2000000000
        ELSE 0
      END
    ELSE 0 END;
  ELSE
    -- 2026-11-v4 allowances (concurrent capacity).
    cap := CASE WHEN state IN ('active', 'trialing') THEN
      CASE plan_id
        WHEN 'starter' THEN 1073741824
        WHEN 'professional' THEN 5368709120
        WHEN 'business' THEN 16106127360
        WHEN 'enterprise' THEN NULL
        WHEN 'free' THEN 104857600
        ELSE 104857600
      END
    ELSE 104857600 END;
  END IF;

  IF cap IS NULL THEN RETURN NEW; END IF;

  SELECT coalesce(
    (SELECT allowance FROM private.workspace_meter_overrides
      WHERE billing_owner = owner AND meter = 'storageBytes' AND expires_at > now()),
    cap
  ) INTO cap;

  IF private.workspace_storage_bytes(owner) + new_bytes - old_bytes > cap THEN
    RAISE EXCEPTION 'workspace_storage_allowance_reached' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
