-- Recognize the complimentary Teams access introduced by migration 039 in
-- the shared-seat lookup too. Preserve paid/legacy allowances and all records.
BEGIN;
CREATE OR REPLACE FUNCTION private.team_entitlement_roots(target uuid)
RETURNS TABLE(owner_id uuid,seats integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH roots AS (
   SELECT target id
   UNION
   SELECT o.owner_id FROM private.memberships m
   JOIN private.organizations o ON o.id=m.organization_id
   WHERE m.user_id=target AND m.active
 )
 SELECT r.id,greatest(3,coalesce(s.seats,3))
 FROM roots r
 LEFT JOIN private.subscriptions s ON s.user_id=r.id
 LEFT JOIN private.entitlement_overrides v ON v.user_id=r.id AND v.expires_at>now()
 LEFT JOIN private.platform_roles p ON p.user_id=r.id AND p.enabled
 LEFT JOIN private.staff_members employee ON employee.user_id=r.id AND employee.enabled
 WHERE p.user_id IS NOT NULL
    OR employee.workspace_plan IN ('team','teams')
    OR v.plan IN ('teams','team')
    OR (v.plan IS NULL AND s.plan IN ('teams','team')
        AND s.status IN ('active','trialing') AND s.seats>=3);
$$;
REVOKE ALL ON FUNCTION private.team_entitlement_roots(uuid) FROM public,anon,authenticated;
COMMIT;
