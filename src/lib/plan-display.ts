import { pricingV4Version } from "./pricing-v4-catalog.mjs";

/** Catalog versions are owned by the catalog module; release builds share the v4 prefix. */
export function isV4PlanVersion(catalogVersion?: string | null): boolean {
  return Boolean(catalogVersion && catalogVersion.startsWith(pricingV4Version));
}

export function isPaidPlan(plan: string): boolean {
  return [
    "individual",
    "team",
    "teams",
    "starter",
    "professional",
    "business",
    "enterprise",
  ].includes(plan);
}

/**
 * Customer-facing plan names.
 *
 * v4 Team deliberately keeps the Stripe/product id `business`, so a plan id
 * alone is ambiguous. Always pass the subscription's catalog_version when it
 * is available.
 */
export function planDisplayName(plan: string, catalogVersion?: string | null): string {
  if (isV4PlanVersion(catalogVersion)) {
    if (plan === "business" || plan === "team" || plan === "teams") return "Team";
    if (plan === "starter") return "Starter";
    if (plan === "professional") return "Professional";
    if (plan === "enterprise") return "Enterprise";
    if (plan === "free") return "Free";
  }
  switch (plan) {
    case "free":
      return "Free";
    case "individual":
      return "Individual";
    case "team":
      return "Teams";
    case "teams":
      return "Teams (legacy)";
    case "pro":
      return "Pro (legacy)";
    case "starter":
      return "Starter";
    case "professional":
      return "Professional";
    case "business":
      return "Business (legacy)";
    case "enterprise":
      return "Enterprise";
    default:
      return plan;
  }
}
