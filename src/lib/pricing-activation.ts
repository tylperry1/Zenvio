import { databaseConfigured, getPool } from "./db";

export type PricingPublicCatalog = "v3" | "v4";

export type PricingV4Settings = {
  previewEnabled: boolean;
  enrollmentEnabled: boolean;
  publicCatalog: PricingPublicCatalog;
};

const defaults: PricingV4Settings = {
  previewEnabled: false,
  enrollmentEnabled: false,
  publicCatalog: "v3",
};

export async function pricingV4Settings(): Promise<PricingV4Settings> {
  if (!databaseConfigured()) return defaults;
  try {
    const value = (
      await getPool().query("SELECT value FROM private.platform_settings WHERE key='pricing_v4'")
    ).rows[0]?.value;
    return {
      previewEnabled: value?.previewEnabled === true,
      enrollmentEnabled: value?.enrollmentEnabled === true,
      publicCatalog: value?.publicCatalog === "v4" ? "v4" : "v3",
    };
  } catch {
    return defaults;
  }
}

/** Live Stripe enrollment still requires existing v3 readiness flags until v4 is validated. */
export function pricingV4EnvGates() {
  return {
    validated: process.env.PRICING_V4_VALIDATED === "true",
    addonValidated: process.env.ADDON_BILLING_VALIDATED === "true",
    checkoutEnabled: process.env.BILLING_CHECKOUT_ENABLED === "true",
  };
}
