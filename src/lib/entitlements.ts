import { envelopeBudget } from "./envelope-usage";
import type { PoolClient } from "pg";
import { getPool } from "./db";
import { ApiError } from "./server";
import {
  contactAllowance,
  hasTeamWorkspaceAccess,
  isTeamCapacityPlan,
  planLimits,
  planLimitsFor,
  type Plan,
} from "./entitlement-policy";
export {
  planLimits,
  planLimitsFor,
  contactAllowance,
  hasTeamWorkspaceAccess,
  isTeamCapacityPlan,
} from "./entitlement-policy";
/**
 * Catalog version that governs a workspace’s own entitlement.
 *
 * An active grant owns its catalog. A grant without a catalog version is the
 * legacy catalog and must never borrow the catalog of a newer subscription, or
 * a legacy Business grant would silently gain v4 Team limits and seats.
 */
export function effectiveCatalogVersion(
  overridePlan?: string | null,
  overrideCatalogVersion?: string | null,
  subscriptionCatalogVersion?: string | null,
): string | null {
  if (overridePlan) return overrideCatalogVersion ?? null;
  return subscriptionCatalogVersion ?? null;
}
export async function entitlementUsage(
  user: string,
  db: Pick<PoolClient, "query"> = getPool(),
) {
  const r = (
    await db.query(
      `SELECT s.plan,s.status,s.seats,s.catalog_version,o.plan override_plan,o.catalog_version override_catalog_version,private.effective_plan(u.id) effective_plan FROM public."user" u LEFT JOIN private.subscriptions s ON s.user_id=u.id LEFT JOIN private.entitlement_overrides o ON o.user_id=u.id AND o.expires_at>now() WHERE u.id=$1`,
      [user],
    )
  ).rows[0];
  const roots = (
    await db.query("SELECT * FROM private.team_entitlement_roots($1)", [user])
  ).rows;
  let catalogVersion = effectiveCatalogVersion(
    r?.override_plan,
    r?.override_catalog_version,
    r?.catalog_version,
  ) as string | null | undefined;
  const plan = (r?.effective_plan ||
    r?.override_plan ||
    (["active", "trialing"].includes(r?.status) ? r?.plan : "free")) as Plan;
  // Members inherit the owner's catalog with the inherited plan (v4 Team=business).
  // Personal subscription catalog alone would leave isTeamCapacityPlan false → 1 seat / wrong limits.
  // Only inherited plans borrow the owner’s catalog; an explicit grant on this
  // account stays authoritative.
  if (
    roots.length &&
    !r?.override_plan &&
    ["team", "teams", "business"].includes(plan) &&
    !isTeamCapacityPlan(plan, catalogVersion)
  ) {
    const root =
      roots.find((row) => row.owner_id === user && row.catalog_version) ||
      roots.find((row) => isTeamCapacityPlan(plan, row.catalog_version)) ||
      roots.find((row) => row.catalog_version) ||
      roots[0];
    if (root?.catalog_version) catalogVersion = root.catalog_version;
  }
  const effective: Plan =
    Object.hasOwn(planLimits, plan) &&
    !(
      ["teams", "team"].includes(plan) &&
      !r?.effective_plan &&
      !r?.override_plan &&
      (r?.seats || 0) < 3
    )
      ? plan
      : "free";
  let seats = isTeamCapacityPlan(effective, catalogVersion)
    ? Math.max(3, r?.seats || 3)
    : 1;
  const u = (
    await db.query(
      `SELECT (SELECT count(*)::int FROM public.event_types e WHERE user_id=$1 AND active AND deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM private.team_event_staff s WHERE s.personal_event_id=e.id)) types,(SELECT count(*)::int FROM private.google_calendar_connections WHERE user_id=$1) calendars,(SELECT count(*)::int FROM private.signature_envelopes WHERE user_id=$1 AND created_at>=date_trunc('month',now()))+(SELECT count(*)::int FROM private.signing_documents WHERE user_id=$1 AND created_at>=date_trunc('month',now())) envelopes,(SELECT count(*)::int FROM private.workflow_rules WHERE user_id=$1 AND enabled) workflows,(SELECT count(*)::int FROM public.contacts WHERE user_id=$1) contacts`,
      [user],
    )
  ).rows[0];
  if (isTeamCapacityPlan(effective, catalogVersion) && roots.length)
    seats = roots.find((r) => r.owner_id === user)?.seats || roots[0].seats;
  const unlimitedSeats = roots.length > 0 && Boolean((await db.query(
    "SELECT 1 FROM private.platform_roles WHERE user_id=ANY($1::uuid[]) AND enabled LIMIT 1",
    [roots.map(root => root.owner_id)],
  )).rows.length);
  const platformIncluded = Boolean((await db.query("SELECT 1 FROM private.platform_roles WHERE user_id=$1 AND enabled", [user])).rows.length);
  const shared = [];
  for (const root of roots) {
    const count = (
      await db.query(
        `WITH hosts AS(SELECT $1::uuid id UNION SELECT m.user_id FROM private.memberships m JOIN private.organizations o ON o.id=m.organization_id WHERE o.owner_id=$1),active_hosts AS(SELECT $1::uuid id UNION SELECT m.user_id FROM private.memberships m JOIN private.organizations o ON o.id=m.organization_id WHERE o.owner_id=$1 AND m.active) SELECT (SELECT count(*)::int FROM private.signature_envelopes WHERE user_id IN(SELECT id FROM hosts) AND created_at>=date_trunc('month',now()))+(SELECT count(*)::int FROM private.signing_documents WHERE user_id IN(SELECT id FROM hosts) AND created_at>=date_trunc('month',now())) envelopes,(SELECT count(*)::int FROM private.workflow_rules WHERE user_id IN(SELECT id FROM active_hosts) AND enabled) workflows`,
        [root.owner_id],
      )
    ).rows[0];
    shared.push({
      owner: root.owner_id,
      seats: root.seats,
      envelopes: count.envelopes,
      workflows: count.workflows,
    });
  }
  const { customer: _customer, subscription: _subscription, ...envelope } = await envelopeBudget(user, db);
  u.envelopes = envelope.sent;
  const limits = {
    ...planLimitsFor(effective, catalogVersion),
    envelopes: envelope.included,
    contacts: contactAllowance(effective, catalogVersion),
  };
  return {
    envelope,
    shared,
    unlimitedSeats,
    platformIncluded,
    canManageTeamBilling: roots.some((r) => r.owner_id === user),
    plan: effective,
    catalogVersion: catalogVersion || "legacy",
    seats,
    limits,
    usage: u,
    paidEnrollmentEnabled: false,
  };
}
export async function requireCapacity(
  db: PoolClient,
  user: string,
  key: Exclude<keyof typeof planLimits.free, "envelopes">,
  additional = 1,
) {
  const roots = (
    await db.query("SELECT * FROM private.team_entitlement_roots($1)", [user])
  ).rows;
  for (const id of [...new Set([user, ...roots.map((r) => r.owner_id)])].sort())
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "entitlements:" + id,
    ]);
  const state = await entitlementUsage(user, db);
  if (
    state.shared.some(
      (s) => !roots.some((r) => r.owner_id === s.owner) && s.owner !== user,
    )
  )
    throw new ApiError("Workspace membership changed. Retry this action.", 409);
  for (const shared of state.shared) {
    const limit =
      key === "workflows" ? state.limits.workflows : null;
    if (
      limit !== null &&
      shared.workflows + additional > limit
    )
      throw new ApiError(
        "The shared Teams workspace allowance is reached. Existing records are preserved. Review workspace usage before adding more.",
        409,
      );
  }
  if (state.usage[key] + additional > state.limits[key])
    throw new ApiError(
      `Your ${state.plan} plan allows ${state.limits[key]} ${key}. Existing records are preserved. Review Plan & billing to upgrade or reduce active usage.`,
      409,
    );
  return state;
}

/** Server-side CRM contact capacity for v4 catalogs. Legacy accounts are skipped. */
export async function requireContactCapacity(db: PoolClient, user: string, additional = 1) {
  const roots = (
    await db.query("SELECT * FROM private.team_entitlement_roots($1)", [user])
  ).rows;
  for (const id of [...new Set([user, ...roots.map((r) => r.owner_id)])].sort())
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "entitlements:" + id,
    ]);
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "contacts:" + (roots.find((r) => r.owner_id === user)?.owner_id || user),
  ]);
  const state = await entitlementUsage(user, db);
  const cap = state.limits.contacts;
  if (cap == null) return state;
  if (state.usage.contacts + additional > cap) {
    throw new ApiError(
      `Your ${state.plan} plan allows ${cap} CRM contacts. Existing records are preserved. Review Plan & billing to upgrade.`,
      409,
    );
  }
  return state;
}
