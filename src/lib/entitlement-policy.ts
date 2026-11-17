import { monthlyAllowances } from "./subscription-offers.mjs";
import { pricingV4Allowances } from "./pricing-v4-catalog.mjs";

const unlimited = 100000;

// Live entitlement ceilings. Historical plan ids remain for grandfathered accounts.
// Proposed v4 plans (starter/professional/enterprise) are additive until activation.
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

export type Plan = keyof typeof planLimits;

/** Plans that include multi-seat team capacity. */
export const teamCapacityPlans = ["team", "teams", "business"] as const;
