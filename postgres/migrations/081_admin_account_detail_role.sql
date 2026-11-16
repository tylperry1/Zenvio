-- Include platform role on account detail so master-admin accounts stay protected in the console.
CREATE OR REPLACE FUNCTION public.admin_account_detail(account_id uuid) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  IF (SELECT public.current_platform_role()) <> 'master_admin' THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'email', u.email,
    'slug', p.slug,
    'timezone', p.timezone,
    'created_at', p.created_at,
    'email_confirmed_at', CASE WHEN u."emailVerified" THEN u."createdAt" END,
    'last_sign_in_at', (SELECT max(s."createdAt") FROM public.session s WHERE s."userId" = u.id),
    'role', CASE WHEN r.enabled THEN r.role ELSE 'member' END,
    'industry', p.industry,
    'events', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', e.id,
            'title', e.title,
            'slug', e.slug,
            'duration', e.duration,
            'active', e.active
          )
          ORDER BY e.created_at
        )
        FROM public.event_types e
        WHERE e.user_id = p.id AND e.deleted_at IS NULL
      ),
      '[]'::jsonb
    ),
    'booking_count', (SELECT count(*) FROM public.bookings b WHERE b.user_id = p.id),
    'contact_count', (SELECT count(*) FROM public.contacts c WHERE c.user_id = p.id)
  )
  INTO result
  FROM public.profiles p
  JOIN public."user" u ON u.id = p.id
  LEFT JOIN private.platform_roles r ON r.user_id = p.id
  WHERE p.id = account_id;
  IF result IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_account_detail(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_account_detail(uuid) TO authenticated;
