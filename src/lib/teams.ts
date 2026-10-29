import type { PoolClient } from "pg";
import { ApiError } from "./server";
export async function teamRole(
  db: Pick<PoolClient, "query">,
  user: string,
  organization: string,
  manage = false,
) {
  const r = (
    await db.query(
      "SELECT m.role,o.owner_id,o.name,o.slug FROM private.memberships m JOIN private.organizations o ON o.id=m.organization_id WHERE m.user_id=$1 AND m.organization_id=$2 AND m.active",
      [user, organization],
    )
  ).rows[0];
  if (!r || (manage && !["owner", "administrator"].includes(r.role)))
    throw new ApiError("Workspace access denied.", 403);
  return r;
}
