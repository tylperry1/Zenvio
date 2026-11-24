import { currentCatalog, type BillingCatalog } from "./billing-catalog";
import { pricingV4EnvGates, pricingV4Settings, type PricingV4Settings } from "./pricing-activation";
import {
  pricingV4Addons,
  pricingV4Allowances,
  pricingV4ExtraSeat,
  pricingV4Features,
  pricingV4Flagship,
  pricingV4Hero,
  pricingV4Offers,
  pricingV4Tagline,
  pricingV4Version,
} from "./pricing-v4-catalog.mjs";
import { addonOffers, catalogVersion as v3CatalogVersion } from "./subscription-offers.mjs";
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
  family: "v3" | "v4";
  /** True when the public page shows proposed v4 that is not yet purchasable. */
  previewOnly: boolean;
  settings: PricingV4Settings;
  gates: ReturnType<typeof pricingV4EnvGates>;
  liveCatalog: BillingCatalog;
  enrollment: {
    enabled: boolean;
    catalogVersion: string;
    plans: string[];
    periods: ("monthly" | "annual")[];
  };
  display: {
    version: string;
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
 * Single public pricing surface used by /pricing, homepage, and /api/pricing.
 * Prevents "show v4, sell v3" drift by keeping display + enrollment metadata together.
 */
export async function publicPricingSurface(): Promise<PublicPricingSurface> {
  const [settings, liveCatalog, readiness] = await Promise.all([
    pricingV4Settings(),
    currentCatalog(),
    billingReadiness(),
  ]);
  const gates = pricingV4EnvGates();
  const showV4 = settings.previewEnabled && settings.publicCatalog === "v4";

  // Live enrollment stays on the published v3 catalog until v4 is validated AND
  // explicitly enabled. Financial Intelligence forces enrollmentEnabled false.
  const v4EnrollmentReady =
    gates.validated && settings.enrollmentEnabled && readiness.v4CheckoutEnabled;

  if (showV4) {
    const paidOffers = pricingV4Offers.filter((o) => o.id !== "free" && !("custom" in o && o.custom));
    return {
      family: "v4",
      previewOnly: !v4EnrollmentReady,
      settings,
      gates,
      liveCatalog,
      enrollment: {
        enabled: v4EnrollmentReady,
        catalogVersion: pricingV4Version,
        plans: v4EnrollmentReady ? paidOffers.map((o) => o.id) : [],
        periods: v4EnrollmentReady ? ["monthly", "annual"] : [],
      },
      display: {
        version: pricingV4Version,
        tagline: pricingV4Tagline,
        hero: pricingV4Hero,
        flagship: pricingV4Flagship,
        offers: pricingV4Offers.map((o) => ({
          id: o.id,
          name: o.name,
          monthly: o.monthly,
          annual: o.annual,
          seats: o.seats,
          recommended: o.recommended,
          custom: "custom" in o ? Boolean(o.custom) : false,
        })),
        extraSeat: { ...pricingV4ExtraSeat },
        allowances: pricingV4Allowances as Record<string, Record<string, number | null>>,
        features: pricingV4Features as Record<string, readonly string[]>,
        addons: publicAddonsForDisplay(pricingV4Addons),
      },
    };
  }

  const extra = liveCatalog.offers.find((o) => o.id === "team_extra");
  return {
    family: "v3",
    previewOnly: false,
    settings,
    gates,
    liveCatalog,
    enrollment: {
      enabled: readiness.checkoutEnabled,
      catalogVersion: liveCatalog.version || v3CatalogVersion,
      plans: readiness.checkoutEnabled ? ["individual", "team"] : [],
      periods: ["monthly"],
    },
    display: {
      version: liveCatalog.version || v3CatalogVersion,
      tagline: null,
      hero: null,
      flagship: null,
      offers: liveCatalog.offers
        .filter((o) => o.id !== "team_extra")
        .map((o) => ({
          id: o.id,
          name: o.name,
          monthly: o.monthly,
          annual: o.annual || 0,
          seats: o.seats,
        })),
      extraSeat: extra
        ? {
            id: extra.id,
            name: extra.name,
            monthly: extra.monthly,
            annual: extra.annual || 0,
            seats: extra.seats,
          }
        : null,
      allowances: liveCatalog.allowances as Record<string, Record<string, number | null>>,
      features: null,
      addons: publicAddonsForDisplay(addonOffers),
    },
  };
}
