import { marketplaceVisible } from "./marketplace-visibility";
import { headers } from "next/headers";
import { getAuth } from "./auth";
import { adminAccess } from "./admin";
import { configured } from "./server";
import { getPool } from "./db";
import { contractorIndustry } from "./contractor";
import { launchControls } from "./launch-controls";
import { resolveTeamPermissions, type TeamPermission } from "./team-permissions";
import type { CustomerFeature, CustomerRole } from "./customer-nav";

const noAccess = {
  user: null,
  admin: false,
  jobs: false,
  marketplace: false,
  role: null,
  permissions: [] as TeamPermission[],
  features: { smartCards: true, growth: true, assistant: true } as Record<CustomerFeature, boolean>,
};

/**
 * A membership row wins over "solo owner": teammates see only customer
 * navigation for the workspace they belong to, never console chrome.
 */
async function membership(user: string) {
  const row = (
    await getPool().query(
      `SELECT m.role, p.permissions
         FROM private.memberships m
         LEFT JOIN private.team_role_permissions p
           ON p.organization_id = m.organization_id AND p.role = m.role
        WHERE m.user_id = $1 AND m.active
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'administrator' THEN 1 ELSE 2 END
        LIMIT 1`,
      [user],
    )
  ).rows[0];
  if (!row) return { role: "owner" as CustomerRole, permissions: resolveTeamPermissions("owner") };
  const role = (["owner", "administrator", "staff"] as const).includes(row.role)
    ? (row.role as CustomerRole)
    : "staff";
  return { role, permissions: resolveTeamPermissions(role, row.permissions) };
}

// Shell chrome only: pages still enforce their own session requirements.
export async function shellSession() {
  if (!configured()) return noAccess;
  try {
    const current = await getAuth().api.getSession({ headers: await headers() });
    if (!current) return noAccess;
    const pool = getPool();
    const [role, profile, controls, team] = await Promise.all([
      adminAccess(current.user.id),
      pool.query("SELECT industry FROM public.profiles WHERE id=$1", [current.user.id]),
      launchControls(),
      // Older deployments may not have memberships yet; a missing table means
      // this is a solo workspace, not a signed-out one.
      membership(current.user.id).catch(() => ({
        role: "owner" as CustomerRole,
        permissions: resolveTeamPermissions("owner"),
      })),
    ]);
    return {
      user: { name: current.user.name || current.user.email, email: current.user.email },
      // Master admin and Zenvio employees both see the console link.
      admin: Boolean(role),
      // Contractor tools appear only for businesses that chose a trade preset.
      jobs: contractorIndustry(profile.rows[0]?.industry),
      marketplace: await marketplaceVisible(),
      role: team.role,
      permissions: team.permissions,
      features: {
        smartCards: controls.features.smartCards,
        growth: controls.features.growth,
        assistant: controls.features.assistant,
      } as Record<CustomerFeature, boolean>,
    };
  } catch {
    return noAccess;
  }
}
