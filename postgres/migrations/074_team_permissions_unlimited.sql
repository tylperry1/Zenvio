BEGIN;
CREATE TABLE private.team_role_permissions(
 organization_id uuid NOT NULL REFERENCES private.organizations(id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('administrator','staff')),
 permissions text[] NOT NULL DEFAULT '{}' CHECK(permissions <@ ARRAY['members','pages','appointments','settings','schedule']::text[]),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,role)
);
ALTER TABLE private.team_role_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.team_role_permissions FROM public,anon,authenticated;
-- Unlimited is an explicit server entitlement, never a paid seat quantity.
CREATE OR REPLACE FUNCTION private.team_entitlement_roots(target uuid)
RETURNS TABLE(owner_id uuid,seats integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH roots AS (
 SELECT target id UNION SELECT o.owner_id FROM private.memberships m
 JOIN private.organizations o ON o.id=m.organization_id WHERE m.user_id=target AND m.active
 )
 SELECT r.id,CASE WHEN p.user_id IS NOT NULL THEN 2147483647 ELSE greatest(3,coalesce(s.seats,3)) END
 FROM roots r LEFT JOIN private.subscriptions s ON s.user_id=r.id
 LEFT JOIN private.entitlement_overrides v ON v.user_id=r.id AND v.expires_at>now()
 LEFT JOIN private.platform_roles p ON p.user_id=r.id AND p.enabled
 LEFT JOIN private.staff_members employee ON employee.user_id=r.id AND employee.enabled
 WHERE p.user_id IS NOT NULL OR employee.workspace_plan IN ('team','teams') OR v.plan IN ('teams','team')
 OR (v.plan IS NULL AND s.plan IN ('teams','team') AND s.status IN ('active','trialing') AND s.seats>=3);
$$;
CREATE OR REPLACE FUNCTION private.effective_plan(target uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(
 (SELECT 'team' FROM private.platform_roles WHERE user_id=target AND enabled),
 (SELECT workspace_plan FROM private.staff_members WHERE user_id=target AND enabled AND workspace_plan IS NOT NULL),
 (SELECT plan FROM private.entitlement_overrides WHERE user_id=target AND expires_at>now()),
 CASE WHEN EXISTS(SELECT 1 FROM private.team_entitlement_roots(target) r JOIN private.platform_roles p ON p.user_id=r.owner_id AND p.enabled) THEN 'team'
 WHEN EXISTS(SELECT 1 FROM private.team_entitlement_roots(target) r JOIN private.subscriptions s ON s.user_id=r.owner_id WHERE s.plan='team' AND s.status IN ('active','trialing')) THEN 'team'
 WHEN EXISTS(SELECT 1 FROM private.team_entitlement_roots(target)) THEN 'teams' END,
 (SELECT plan FROM private.subscriptions WHERE user_id=target AND status IN ('active','trialing') AND (plan NOT IN ('teams','team') OR seats>=3)), 'free');
$$;
REVOKE ALL ON FUNCTION private.team_entitlement_roots(uuid),private.effective_plan(uuid) FROM public,anon,authenticated;
COMMIT;
