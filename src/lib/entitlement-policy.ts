import { monthlyAllowances } from "./subscription-offers.mjs";
import { pricingV4Allowances, pricingV4Version } from "./pricing-v4-catalog.mjs";

const unlimited = 100000;

// Live entitlement ceilings. Historical plan ids remain for grandfathered accounts.
// v4 Team uses plan id `business` with catalog_version 2026-11-v4 — resolve via planLimitsFor().
export const planLimits = {
  individual: {
    types: 100,
    calendars: 5,
    envelopes: monthlyAllowances.individual.envelopes,
    workflows: 25,
  },
  team: {
    types: 100,
    calendars: 5,
    envelopes: monthlyAllowances.team.envelopes,
    workflows: 25,
  },
  // Legacy free + legacy solo Business remain for grandfathered rows.
  free: { types: 1, calendars: 1, envelopes: 5, workflows: 0 },
  pro: { types: 10, calendars: 5, envelopes: 25, workflows: 5 },
  business: { types: 50, calendars: 5, envelopes: 100, workflows: 20 },
  teams: { types: 100, calendars: 5, envelopes: 100, workflows: 25 },
  starter: {
    types: pricingV4Allowances.starter.serviceTypes ?? unlimited,
    calendars: 5,
    envelopes: pricingV4Allowances.starter.envelopes ?? 0,
    workflows: pricingV4Allowances.starter.workflows ?? 0,
  },
  professional: {
    types: unlimited,
    calendars: 5,
    envelopes: pricingV4Allowances.professional.envelopes ?? 0,
    workflows: pricingV4Allowances.professional.workflows ?? 0,
  },
  enterprise: {
    types: unlimited,
    calendars: 10,
    envelopes: unlimited,
    workflows: unlimited,
  },
} as const;

/** v4 Free ceilings — only applied when catalog_version is 2026-11-v4. */
export const pricingV4PlanLimits = {
  free: {
    types: pricingV4Allowances.free.serviceTypes ?? 2,
    calendars: 1,
    envelopes: pricingV4Allowances.free.envelopes ?? 0,
    workflows: pricingV4Allowances.free.workflows ?? 0,
  },
  starter: planLimits.starter,
  professional: planLimits.professional,
  /** Team plan (Stripe/product id remains `business`). */
  business: {
    types: unlimited,
    calendars: 5,
    envelopes: pricingV4Allowances.business.envelopes ?? 0,
    workflows: pricingV4Allowances.business.workflows ?? 0,
  },
  enterprise: planLimits.enterprise,
} as const;

export type Plan = keyof typeof planLimits;

export function isV4CatalogVersion(catalogVersion?: string | null): boolean {
  return Boolean(
    catalogVersion &&
      (catalogVersion === pricingV4Version || catalogVersion.startsWith(pricingV4Version)),
  );
}

/** Resolve capacity ceilings for a plan, preferring v4 Team over legacy solo Business. */
export function planLimitsFor(plan: string, catalogVersion?: string | null) {
  if (isV4CatalogVersion(catalogVersion)) {
    const v4 = pricingV4PlanLimits[plan as keyof typeof pricingV4PlanLimits];
    if (v4) return v4;
  }
  if (Object.hasOwn(planLimits, plan)) return planLimits[plan as Plan];
  return planLimits.free;
}

/**
 * Plans that include multi-seat team capacity.
 * Legacy solo `business` stays seat=1 in practice; v4 Team uses the same id
 * with catalog_version 2026-11-v4 and included seats=3. Prefer isTeamCapacityPlan().
 */
export const teamCapacityPlans = ["team", "teams", "business"] as const;

/** Multi-seat capacity for Teams (v3) and Team (v4). Legacy solo business remains single-seat. */
export function isTeamCapacityPlan(plan: string, catalogVersion?: string | null): boolean {
  if (plan === "team" || plan === "teams") return true;
  if (plan === "business") return isV4CatalogVersion(catalogVersion);
  return false;
}

/** Whether a resolved entitlementUsage plan may create/manage a team workspace. */
export function hasTeamWorkspaceAccess(
  plan: string,
  catalogVersion?: string | null,
): boolean {
  return isTeamCapacityPlan(plan, catalogVersion);
}

/** Contact allowance for CRM capacity checks. null = unlimited / not enforced. */
export function contactAllowance(plan: string, catalogVersion?: string | null): number | null {
  if (!isV4CatalogVersion(catalogVersion)) return null;
  const table = pricingV4Allowances[plan as keyof typeof pricingV4Allowances];
  if (!table) return plan === "free" ? 100 : null;
  return table.contacts;
}
