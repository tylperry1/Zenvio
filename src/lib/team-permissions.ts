export const teamPermissions = {
  members: "Invite and manage staff",
  pages: "Manage shared booking pages",
  appointments: "Reassign and cancel team appointments",
  settings: "Rename the workspace",
  schedule: "View the full team schedule",
} as const;
export type TeamPermission = keyof typeof teamPermissions;
export const defaultTeamPermissions: Record<string, TeamPermission[]> = {
  administrator: ["members", "pages", "appointments", "settings", "schedule"],
  staff: [],
};
export function resolveTeamPermissions(role: string, configured?: unknown): TeamPermission[] {
  if (role === "owner") return Object.keys(teamPermissions) as TeamPermission[];
  const values = Array.isArray(configured) ? configured : defaultTeamPermissions[role] || [];
  return values.filter((value): value is TeamPermission => typeof value === "string" && Object.hasOwn(teamPermissions, value));
}
export function canManageTeam(role: string, permissions: TeamPermission[], permission: TeamPermission) {
  return role === "owner" || permissions.includes(permission);
}
export const teamActionPermission: Record<string, TeamPermission> = {
  invite: "members", "revoke-invite": "members", remove: "members", reactivate: "members",
  event: "pages", reassign: "appointments", cancel: "appointments", rename: "settings",
};
