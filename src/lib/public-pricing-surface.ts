import { billingEnvGates, billingSettings, type BillingSettings } from "./pricing-activation";
import {
  ADDONS,
  EXTRA_SEAT,
  PLAN_ALLOWANCES,
  PLAN_FEATURES,
  PLANS,
  FLAGSHIP_PLAN,
  PRICING_TAGLINE,
  PRICING_HERO,
} from "./pricing-catalog.mjs";
import { billingReadiness } from "./billing-readiness";
import {
  publicAddonsForDisplay,
  type PublicAddon,
  formatUsdCents,
  liveBillingHelpText,
} from "./public-pricing-display";

export type { PublicAddon };
export { publicAddonsForDisplay, formatUsdCents, liveBillingHelpText };

export type PublicPricingSurface = {
  /** One catalog: the public page always shows the current plans. */
  family: "plans";
  /** True when paid enrollment is not open yet; prices are shown without a CTA. */
  previewOnly: boolean;
  settings: BillingSettings;
  gates: ReturnType<typeof billingEnvGates>;
  liveCatalog: {
    offers: { id: string; name: string; monthly: number; annual: number; seats: number }[];
    allowances: Record<string, Record<string, number | null>>;
  };
  enrollment: {
    enabled: boolean;
    plans: string[];
    periods: ("monthly" | "annual")[];
  };
  display: {
    tagline: string | null;
    hero: string | null;
    flagship: string | null;
    offers: {
      id: string;
      name: string;
      monthly: number | null;
      annual: number | null;
      seats: number | null;
      recommended?: boolean;
      custom?: boolean;
    }[];
    extraSeat: { id: string; name: string; monthly: number; annual: number; seats: number } | null;
    allowances: Record<string, Record<string, number | null>>;
    features: Record<string, readonly string[]> | null;
    addons: PublicAddon[];
  };
};

/**
 * The single public pricing surface used by /pricing, the homepage, /api/pricing
 * and /api/billing. Display and enrollment metadata come from the same
 * configuration, so the page can never show one price and sell another.
 */
export async function publicPricingSurface(): Promise<PublicPricingSurface> {
  const [settings, readiness] = await Promise.all([billingSettings(), billingReadiness()]);
  const gates = billingEnvGates();
  const enabled =
    settings.enrollmentEnabled && gates.validated && readiness.checkoutEnabled;
  const paidPlans = PLANS.filter((plan) => plan.paid && !plan.custom);

  return {
    family: "plans",
    previewOnly: !enabled,
    settings,
    gates,
    liveCatalog: {
      offers: PLANS.filter((plan) => !plan.custom).map((plan) => ({
        id: plan.id,
        name: plan.name,
        monthly: plan.monthly ?? 0,
        annual: plan.annual ?? 0,
        seats: plan.seats ?? 1,
      })),
      allowances: PLAN_ALLOWANCES as unknown as Record<string, Record<string, number | null>>,
    },
    enrollment: {
      enabled,
      plans: enabled ? paidPlans.map((plan) => plan.id) : [],
      periods: enabled ? ["monthly", "annual"] : [],
    },
    display: {
      tagline: PRICING_TAGLINE,
      hero: PRICING_HERO,
      flagship: FLAGSHIP_PLAN,
      offers: PLANS.map((plan) => ({
        id: plan.id,
        name: plan.name,
        monthly: plan.monthly,
        annual: plan.annual,
        seats: plan.seats,
        recommended: plan.recommended,
        custom: "custom" in plan ? Boolean(plan.custom) : false,
      })),
      extraSeat: { ...EXTRA_SEAT },
      allowances: PLAN_ALLOWANCES as unknown as Record<string, Record<string, number | null>>,
      features: PLAN_FEATURES as unknown as Record<string, readonly string[]>,
      addons: publicAddonsForDisplay(ADDONS),
    },
  };
}
