-- Keep old booking addresses working after a profile slug change.
CREATE TABLE IF NOT EXISTS private.booking_slug_aliases (
  slug text PRIMARY KEY
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 3 AND 60),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_slug_aliases_user_id
  ON private.booking_slug_aliases(user_id);
REVOKE ALL ON private.booking_slug_aliases FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.resolve_booking_slug(host_slug text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT p.slug FROM public.profiles p WHERE p.slug = host_slug),
    (
      SELECT p.slug
      FROM private.booking_slug_aliases a
      JOIN public.profiles p ON p.id = a.user_id
      WHERE a.slug = host_slug
    )
  );
$$;
REVOKE ALL ON FUNCTION public.resolve_booking_slug(text) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_booking_slug(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION private.guard_booking_slug_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug
     AND EXISTS (
       SELECT 1 FROM private.booking_slug_aliases a
       WHERE a.slug = NEW.slug AND a.user_id <> NEW.id
     ) THEN
    RAISE EXCEPTION 'invalid_slug' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_booking_slug_claim ON public.profiles;
CREATE TRIGGER profiles_guard_booking_slug_claim
  BEFORE UPDATE OF slug ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_booking_slug_claim();

CREATE OR REPLACE FUNCTION private.record_booking_slug_alias()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    DELETE FROM private.booking_slug_aliases
    WHERE user_id = NEW.id AND slug = NEW.slug;
    INSERT INTO private.booking_slug_aliases(slug, user_id)
    VALUES (OLD.slug, NEW.id)
    ON CONFLICT (slug) DO UPDATE
      SET user_id = EXCLUDED.user_id, created_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_record_booking_slug_alias ON public.profiles;
CREATE TRIGGER profiles_record_booking_slug_alias
  AFTER UPDATE OF slug ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION private.record_booking_slug_alias();

-- Preserve public_profile JSON shape; accept current or legacy host slugs.
CREATE OR REPLACE FUNCTION public.public_profile(host_slug text) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'profile', jsonb_build_object(
      'name', p.name,
      'slug', p.slug,
      'timezone', p.timezone,
      'bio', p.bio,
      'headline', p.headline,
      'company', p.company,
      'accent_color', p.accent_color
    ),
    'events', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'slug', e.slug,
            'title', e.title,
            'description', e.description,
            'duration', e.duration,
            'location', e.location,
            'color', e.color
          )
          ORDER BY e.created_at, e.id
        )
        FROM public.event_types e
        WHERE e.user_id = p.id AND e.active AND e.deleted_at IS NULL
      ),
      '[]'::jsonb
    ),
    'resolved_from', CASE WHEN p.slug = host_slug THEN NULL ELSE host_slug END
  )
  FROM public.profiles p
  WHERE p.slug = public.resolve_booking_slug(host_slug);
$$;
REVOKE ALL ON FUNCTION public.public_profile(text) FROM public;
GRANT EXECUTE ON FUNCTION public.public_profile(text) TO anon, authenticated;
