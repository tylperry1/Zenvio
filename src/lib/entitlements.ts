import type { PoolClient } from "pg";
import { getPool } from "./db";
import { ApiError } from "./server";
import { planLimits, type Plan } from "./entitlement-policy";
export { planLimits } from "./entitlement-policy";
export async function entitlementUsage(
  user: string,
  db: Pick<PoolClient, "query"> = getPool(),
) {
  const r = (
    await db.query(
      `SELECT s.plan,s.status,s.seats,o.plan override_plan FROM public."user" u LEFT JOIN private.subscriptions s ON s.user_id=u.id LEFT JOIN private.entitlement_overrides o ON o.user_id=u.id AND o.expires_at>now() WHERE u.id=$1`,
      [user],
    )
  ).rows[0];
  const plan = (r?.override_plan ||
    (["active", "trialing"].includes(r?.status) ? r?.plan : "free")) as Plan;
  const effective: Plan =
    Object.hasOwn(planLimits, plan) &&
    !(plan === "teams" && !r?.override_plan && (r?.seats || 0) < 3)
      ? plan
      : "free";
  const seats = effective === "teams" ? Math.max(3, r?.seats || 3) : 1;
  const u = (
    await db.query(
      `SELECT (SELECT count(*)::int FROM public.event_types e WHERE user_id=$1 AND active AND deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM private.team_event_staff s WHERE s.personal_event_id=e.id)) types,(SELECT count(*)::int FROM private.google_calendar_connections WHERE user_id=$1) calendars,(SELECT count(*)::int FROM private.signature_envelopes WHERE user_id=$1 AND created_at>=date_trunc('month',now()))+(SELECT count(*)::int FROM private.signing_documents WHERE user_id=$1 AND created_at>=date_trunc('month',now())) envelopes,(SELECT count(*)::int FROM private.workflow_rules WHERE user_id=$1 AND enabled) workflows`,
      [user],
    )
  ).rows[0];
  return {
    plan: effective,
    seats,
    limits: {
      ...planLimits[effective],
      envelopes:
        planLimits[effective].envelopes * (effective === "teams" ? seats : 1),
    },
    usage: u,
    paidEnrollmentEnabled: false,
  };
}
export async function requireCapacity(
  db: PoolClient,
  user: string,
  key: keyof typeof planLimits.free,
  additional = 1,
) {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "entitlements:" + user,
  ]);
  const state = await entitlementUsage(user, db);
  if (state.usage[key] + additional > state.limits[key])
    throw new ApiError(
      `Your ${state.plan} plan allows ${state.limits[key]} ${key}. Existing records are preserved. Review Plan & billing to upgrade or reduce active usage.`,
      409,
    );
  return state;
}
