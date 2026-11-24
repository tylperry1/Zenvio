/**
 * Plan labels. Names come from the single pricing configuration, so a plan id
 * always renders the same name regardless of when the subscription was created.
 */
import {
  isPaidPlan as catalogIsPaidPlan,
  planDisplayName as catalogPlanDisplayName,
} from "./pricing-catalog.mjs";

/** @deprecated Plan ids resolve directly; kept so historic call sites type-check. */
export function planDisplayName(plan: string, _catalogVersion?: string | null): string {
  return catalogPlanDisplayName(plan);
}

export function isPaidPlan(plan: string): boolean {
  return catalogIsPaidPlan(plan);
}
