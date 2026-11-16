-- Prefer a short name-based booking address for new accounts.
-- Keep host-<uuid> only when the name cannot produce a valid unique slug.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  base_slug text;
  candidate text;
  suffix integer;
  attempt integer;
BEGIN
  base_slug := lower(regexp_replace(coalesce(nullif(trim(new.name), ''), 'workspace'), '[^a-zA-Z0-9]+', '-', 'g'));
  base_slug := trim(both '-' from base_slug);
  base_slug := rtrim(left(base_slug, 60), '-');
  IF base_slug = 'demo' THEN
    base_slug := 'demo-workspace';
  END IF;

  FOR attempt IN 0..100 LOOP
    IF length(base_slug) < 3 OR base_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
      candidate := 'host-' || replace(new.id::text, '-', '');
    ELSIF attempt = 0 THEN
      candidate := base_slug;
    ELSE
      suffix := attempt;
      candidate := rtrim(left(base_slug, greatest(3, 60 - length('-' || suffix::text))), '-')
        || '-' || suffix::text;
      IF candidate !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(candidate) > 60 THEN
        candidate := 'host-' || replace(new.id::text, '-', '');
      END IF;
    END IF;

    IF attempt = 100 THEN
      candidate := 'host-' || replace(new.id::text, '-', '');
    END IF;

    BEGIN
      INSERT INTO public.profiles(id, name, slug)
      VALUES (new.id, left(coalesce(nullif(new.name, ''), 'My workspace'), 100), candidate);
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        IF candidate LIKE 'host-%' THEN
          RAISE;
        END IF;
        -- Concurrent same-name signup raced on slug; try the next suffix.
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
