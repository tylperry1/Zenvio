/**
 * Entitlement policy.
 *
 * Limits come from the single pricing configuration. Historic plan ids
 * (`individual`, `team`, `teams`, `pro`) resolve to their current plan, so an
 * account's access never depends on a catalog version marker.
 */
import {
  PLAN_LIMITS,
  contactAllowance as catalogContactAllowance,
  isPaidPlan as catalogIsPaidPlan,
  isTeamPlan as catalogIsTeamPlan,
  planId,
} from "./pricing-catalog.mjs";

const unlimited = 100000;

type Limits = { types: number; calendars: number; envelopes: number; workflows: number };

const PLAN_KEYS = [
  "free",
  "starter",
  "professional",
  "business",
  "enterprise",
  "individual",
  "team",
  "teams",
  "pro",
] as const;

/** Capacity ceilings keyed by plan id (including retired ids). */
export const planLimits = Object.fromEntries(
  PLAN_KEYS.map((key) => {
    const limits = PLAN_LIMITS[planId(key) as keyof typeof PLAN_LIMITS] ?? PLAN_LIMITS.free;
    return [
      key,
      {
        types: limits.types ?? unlimited,
        calendars: limits.calendars,
        envelopes: limits.envelopes ?? 0,
        workflows: limits.workflows ?? 0,
      } satisfies Limits,
    ];
  }),
) as Record<(typeof PLAN_KEYS)[number], Limits>;

export type Plan = keyof typeof planLimits;

/**
 * Resolve capacity ceilings for a plan. The second argument is accepted for
 * historic call sites and ignored: limits are plan-based, never version-based.
 */
export function planLimitsFor(plan: string, _catalogVersion?: string | null): Limits {
  return (planLimits as Record<string, Limits>)[plan] ?? planLimits.free;
}

export const teamCapacityPlans = ["team", "teams", "business"] as const;

/** Whether a plan includes multi-seat team capacity. */
export function isTeamCapacityPlan(plan: string, _catalogVersion?: string | null): boolean {
  return catalogIsTeamPlan(plan);
}

/** Whether a resolved entitlement plan may create/manage a team workspace. */
export function hasTeamWorkspaceAccess(
  plan: string,
  _catalogVersion?: string | null,
): boolean {
  return catalogIsTeamPlan(plan);
}

/** Contact allowance for CRM capacity checks. null = unlimited / not enforced. */
export function contactAllowance(plan: string, _catalogVersion?: string | null): number | null {
  return catalogContactAllowance(plan);
}

export function isPaidEntitlementPlan(plan: string): boolean {
  return catalogIsPaidPlan(plan);
}
