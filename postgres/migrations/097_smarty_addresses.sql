-- Smarty address services, typed addresses, booking location modes, and usage.
-- Additive only. Does not enable Smarty or overwrite existing contact addresses.
BEGIN;

CREATE TABLE private.addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  address_type text NOT NULL CHECK (address_type IN (
    'residential', 'billing', 'business', 'service_saved', 'custom_meeting'
  )),
  street text NOT NULL DEFAULT '' CHECK (length(street) <= 200),
  street2 text NOT NULL DEFAULT '' CHECK (length(street2) <= 100),
  city text NOT NULL DEFAULT '' CHECK (length(city) <= 100),
  state text NOT NULL DEFAULT '' CHECK (length(state) <= 50),
  postal_code text NOT NULL DEFAULT '' CHECK (length(postal_code) <= 20),
  country text NOT NULL DEFAULT 'US' CHECK (country ~ '^[A-Z]{2}$'),
  formatted text NOT NULL DEFAULT '' CHECK (length(formatted) <= 500),
  access_instructions text NOT NULL DEFAULT '' CHECK (length(access_instructions) <= 1000),
  validated boolean NOT NULL DEFAULT false,
  smarty_key text NOT NULL DEFAULT '' CHECK (length(smarty_key) <= 64),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'smarty', 'import', 'migration')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT addresses_owner_scope CHECK (
    (address_type = 'business' AND contact_id IS NULL)
    OR (address_type <> 'business' AND contact_id IS NOT NULL)
  )
);

CREATE INDEX addresses_workspace_idx ON private.addresses (workspace_id, address_type, updated_at DESC);
CREATE INDEX addresses_contact_idx ON private.addresses (contact_id, address_type)
  WHERE contact_id IS NOT NULL;

-- Preserve legacy contacts.address text; copy non-empty values into residential rows once.
INSERT INTO private.addresses (
  workspace_id, contact_id, address_type, street, formatted, source
)
SELECT c.user_id, c.id, 'residential', left(trim(c.address), 200), left(trim(c.address), 500), 'migration'
FROM public.contacts c
WHERE trim(c.address) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM private.addresses a
    WHERE a.contact_id = c.id AND a.address_type = 'residential'
  );

ALTER TABLE public.event_types
  ADD COLUMN IF NOT EXISTS location_mode text NOT NULL DEFAULT 'custom'
    CHECK (location_mode IN ('at_business', 'at_customer', 'virtual', 'custom')),
  ADD COLUMN IF NOT EXISTS allowed_location_modes text[] NOT NULL DEFAULT ARRAY['custom']::text[],
  ADD COLUMN IF NOT EXISTS virtual_instructions text NOT NULL DEFAULT ''
    CHECK (length(virtual_instructions) <= 2000),
  ADD COLUMN IF NOT EXISTS custom_location_prompt text NOT NULL DEFAULT ''
    CHECK (length(custom_location_prompt) <= 500);

-- Backfill before the compound check so existing "Phone call" / Zoom rows never
-- temporarily violate location_mode ∈ allowed_location_modes.
ALTER TABLE public.event_types
  DROP CONSTRAINT IF EXISTS event_types_allowed_location_modes_check;

UPDATE public.event_types SET
  location_mode = inferred.mode,
  allowed_location_modes = ARRAY[inferred.mode]::text[]
FROM (
  SELECT id,
    CASE
      WHEN lower(location) ~ '(video|zoom|google meet|teams|virtual|phone call|facetime)' THEN 'virtual'
      WHEN lower(location) ~ '(my (office|studio|shop|location)|at (the )?(business|office)|in[- ]person office)' THEN 'at_business'
      WHEN lower(location) ~ '(your (home|location|address|place)|on[- ]site|customer location|client location|mobile service)' THEN 'at_customer'
      ELSE 'custom'
    END AS mode
  FROM public.event_types
) inferred
WHERE public.event_types.id = inferred.id
  AND public.event_types.location_mode = 'custom'
  AND public.event_types.allowed_location_modes = ARRAY['custom']::text[];

ALTER TABLE public.event_types
  ADD CONSTRAINT event_types_allowed_location_modes_check CHECK (
    cardinality(allowed_location_modes) BETWEEN 1 AND 4
    AND allowed_location_modes <@ ARRAY['at_business', 'at_customer', 'virtual', 'custom']::text[]
    AND location_mode = ANY (allowed_location_modes)
  );

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS location_mode text
    CHECK (location_mode IS NULL OR location_mode IN ('at_business', 'at_customer', 'virtual', 'custom')),
  ADD COLUMN IF NOT EXISTS service_address jsonb,
  ADD COLUMN IF NOT EXISTS access_instructions text NOT NULL DEFAULT ''
    CHECK (length(access_instructions) <= 1000);

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_service_address_object;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_service_address_object CHECK (
    service_address IS NULL OR jsonb_typeof(service_address) = 'object'
  );

CREATE TABLE private.smarty_api_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation text NOT NULL CHECK (operation IN ('autocomplete', 'validate', 'health')),
  status_code integer,
  category text NOT NULL DEFAULT 'unknown'
    CHECK (category IN (
      'invalid_credentials', 'payment_required', 'rate_limited', 'bad_request',
      'unavailable', 'network', 'disabled', 'unknown'
    )),
  message text NOT NULL DEFAULT '' CHECK (length(message) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX smarty_api_errors_created_idx ON private.smarty_api_errors (created_at DESC);

-- Smarty stays disabled until a master admin enables it after storing vault credentials.
-- Runtime defaults are seeded by src/lib/smarty/config.ts under key smarty:<environment>.

REVOKE ALL ON private.addresses, private.smarty_api_errors FROM public, anon, authenticated;

COMMIT;
