import { ApiError, backend, session } from "./server";

import {
  allStaffPermissions,
  isStaffPermission,
  type StaffPermission,
} from "./admin-sections";
export {
  staffPermissions,
  allStaffPermissions,
  isStaffPermission,
  type StaffPermission,
} from "./admin-sections";

export type AdminAccess =
  | { role: "master_admin"; title: string; permissions: StaffPermission[] }
  | { role: "staff"; title: string; permissions: StaffPermission[] };

export async function platformRole(
  token: string,
): Promise<"master_admin" | "member"> {
  const role = await backend(
    "/rest/v1/rpc/current_platform_role",
    { method: "POST", body: "{}" },
    token,
  );
  return role === "master_admin" ? "master_admin" : "member";
}

// Resolves console access from the database on every request so revoking a
// role or permission takes effect immediately.
export async function adminAccess(token: string): Promise<AdminAccess | null> {
  if ((await platformRole(token)) === "master_admin")
    return { role: "master_admin", title: "Master admin", permissions: allStaffPermissions };
  const staff = await backend(
    "/rest/v1/rpc/current_staff_access",
    { method: "POST", body: "{}" },
    token,
  );
  if (!staff || typeof staff !== "object") return null;
  const permissions = Array.isArray(staff.permissions)
    ? staff.permissions.filter(isStaffPermission)
    : [];
  return { role: "staff", title: String(staff.title || "Zenvio team"), permissions };
}

export function canAccess(access: AdminAccess | null, permission: StaffPermission) {
  return Boolean(
    access && (access.role === "master_admin" || access.permissions.includes(permission)),
  );
}

/**
 * Authorizes an admin request. With no argument only the master admin passes.
 * With one or more permissions, employees holding any of them pass as well.
 */
export async function adminSession(
  permission?: StaffPermission | StaffPermission[],
) {
  const current = await session();
  const access = await adminAccess(current.token);
  const needed = permission === undefined ? [] : [permission].flat();
  if (
    !access ||
    (access.role !== "master_admin" &&
      (!needed.length || !needed.some((p) => access.permissions.includes(p))))
  )
    throw new ApiError(
      "This area is reserved for the platform administrator.",
      403,
    );
  return { ...current, access };
}
