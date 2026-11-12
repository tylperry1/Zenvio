import type { PoolClient } from "pg";
import { ApiError } from "./server";
import { resolveTeamPermissions } from "./team-permissions";
export async function teamRole(
  db: Pick<PoolClient, "query">,
  user: string,
  organization: string,
  manage = false,
) {
  const r = (
    await db.query(
      "SELECT m.role,o.owner_id,o.name,o.slug,p.permissions FROM private.memberships m JOIN private.organizations o ON o.id=m.organization_id LEFT JOIN private.team_role_permissions p ON p.organization_id=o.id AND p.role=m.role WHERE m.user_id=$1 AND m.organization_id=$2 AND m.active",
      [user, organization],
    )
  ).rows[0];
  if (!r || (manage && !["owner", "administrator"].includes(r.role)))
    throw new ApiError("Workspace access denied.", 403);
  return { ...r, permissions: resolveTeamPermissions(r.role, r.permissions) };
}
