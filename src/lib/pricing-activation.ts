import { databaseConfigured, getPool } from "./db";

/**
 * Billing activation settings.
 *
 * There is one catalog and one activation path. `enrollmentEnabled` is the
 * single paid-enrollment switch; the environment supplies the validation flag.
 * The settings row is keyed `billing`; nothing branches on a catalog version.
 */
export type BillingSettings = {
  enrollmentEnabled: boolean;
};

const defaults: BillingSettings = {
  enrollmentEnabled: false,
};

export async function billingSettings(): Promise<BillingSettings> {
  if (!databaseConfigured()) return defaults;
  try {
    const value = (
      await getPool().query("SELECT value FROM private.platform_settings WHERE key='billing'")
    ).rows[0]?.value;
    return { enrollmentEnabled: value?.enrollmentEnabled === true };
  } catch {
    return defaults;
  }
}

/**
 * One validation flag for the single catalog, plus the operator's checkout
 * switch and the separate add-on acceptance.
 */
export function billingEnvGates() {
  return {
    validated: process.env.BILLING_VALIDATED === "true",
    addonValidated: process.env.ADDON_BILLING_VALIDATED === "true",
    checkoutEnabled: process.env.BILLING_CHECKOUT_ENABLED === "true",
  };
}
