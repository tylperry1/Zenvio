-- Serialize booking-slug claims against alias reservations (TOCTOU),
-- and identify the UUID host-<uuid> fallback by exact value so names like
-- "Host Team" can still retry as host-team-1.

CREATE OR REPLACE FUNCTION private.guard_booking_slug_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.slug IS DISTINCT FROM OLD.slug THEN
    -- Separate statement so READ COMMITTED takes a fresh snapshot after waiters commit.
    PERFORM pg_advisory_xact_lock(hashtextextended('booking_slug:' || NEW.slug, 0));
    IF EXISTS (
      SELECT 1 FROM private.booking_slug_aliases a
      WHERE a.slug = NEW.slug AND a.user_id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'invalid_slug' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.record_booking_slug_alias()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    -- Same key as guard_booking_slug_claim so renames and claims serialize.
    PERFORM pg_advisory_xact_lock(hashtextextended('booking_slug:' || OLD.slug, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('booking_slug:' || NEW.slug, 0));
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

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  base_slug text;
  candidate text;
  uuid_fallback text;
  suffix integer;
  attempt integer;
  taken boolean;
BEGIN
  uuid_fallback := 'host-' || replace(new.id::text, '-', '');
  base_slug := lower(regexp_replace(coalesce(nullif(trim(new.name), ''), 'workspace'), '[^a-zA-Z0-9]+', '-', 'g'));
  base_slug := trim(both '-' from base_slug);
  base_slug := rtrim(left(base_slug, 60), '-');
  IF base_slug = 'demo' THEN
    base_slug := 'demo-workspace';
  END IF;

  FOR attempt IN 0..100 LOOP
    IF length(base_slug) < 3 OR base_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
      candidate := uuid_fallback;
    ELSIF attempt = 0 THEN
      candidate := base_slug;
    ELSE
      suffix := attempt;
      candidate := rtrim(left(base_slug, greatest(3, 60 - length('-' || suffix::text))), '-')
        || '-' || suffix::text;
      IF candidate !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(candidate) > 60 THEN
        candidate := uuid_fallback;
      END IF;
    END IF;

    IF attempt = 100 THEN
      candidate := uuid_fallback;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.slug = candidate
    ) OR EXISTS (
      SELECT 1 FROM private.booking_slug_aliases a WHERE a.slug = candidate
    ) INTO taken;

    IF taken THEN
      IF candidate = uuid_fallback THEN
        RAISE EXCEPTION 'Unable to allocate booking address' USING ERRCODE = '23505';
      END IF;
      -- Current slug or reserved alias is taken; try the next suffix.
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO public.profiles(id, name, slug)
      VALUES (new.id, left(coalesce(nullif(new.name, ''), 'My workspace'), 100), candidate);
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        IF candidate = uuid_fallback THEN
          RAISE;
        END IF;
        -- Concurrent same-name signup raced on slug; try the next suffix.
        CONTINUE;
      WHEN check_violation THEN
        IF candidate = uuid_fallback THEN
          RAISE;
        END IF;
        -- Alias reservation (or slug check) blocked the claim; try the next suffix.
        CONTINUE;
    END;
  END LOOP;

  INSERT INTO public.availability(user_id, day, enabled)
  SELECT new.id, d, d BETWEEN 1 AND 5 FROM generate_series(0, 6) d;
  INSERT INTO public.event_types(user_id, title, slug, description, duration, location)
  VALUES (
    new.id,
    'Discovery call',
    'discovery-call',
    'A little time to connect, talk through your goals, and see how we can help.',
    30,
    'Phone call'
  );
  RETURN new;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;
