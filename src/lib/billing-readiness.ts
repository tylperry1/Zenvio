import { launchControls,sandboxAccepted } from "./launch-controls";
import { databaseConfigured, getPool } from "./db";
import { integrationValue } from "./platform-settings";
import { stripeDeploymentEnvironment, stripeKeyMode, stripeKeyProblem } from "./stripe-environment";
import { pricingV4Version } from "./pricing-v4-catalog.mjs";

/** Legacy 2026-11-v3 recurring plans (Individual, Teams, Team seat). */
const V3_PLANS = ["individual", "team", "team_extra"];
/** Approved 2026-11-v4 launch catalog: Starter, Professional, Team, Additional Team seat. */
const V4_PLANS = ["starter", "professional", "business", "business_extra"];
const V4_REQUIRED = V4_PLANS.flatMap((plan) => [
  [plan, "monthly"],
  [plan, "annual"],
] as const);

const unavailable = (reason: string) => ({
  connected: false,
  pricesReady: false,
  checkoutEnabled: false,
  v4PricesReady: false,
  v4CheckoutEnabled: false,
  blockers: [reason],
  v4Blockers: [reason],
});

/**
 * Billing readiness for both catalogs. `checkoutEnabled` keeps its v3 meaning
 * (legacy Individual/Teams changes); v4 launch surfaces must use
 * `v4CheckoutEnabled`, which never depends on v3 mappings or the v3 flag.
 */
export async function billingReadiness() {
  if (!databaseConfigured()) {
    return unavailable("Account database isn’t available");
  }
  const catalog=await (await import("./billing-catalog")).currentCatalog();
  const [key, webhook, v3Rows, v4Rows] = await Promise.all([
    integrationValue("STRIPE_SECRET_KEY"), integrationValue("STRIPE_WEBHOOK_SECRET"),
    getPool().query("SELECT plan FROM private.subscription_prices WHERE catalog_version=$1 AND period='monthly' AND plan = ANY($2::text[])", [catalog.version, V3_PLANS]),
    getPool().query("SELECT plan, period FROM private.subscription_prices WHERE catalog_version=$1 AND plan = ANY($2::text[])", [pricingV4Version, V4_PLANS]),
  ]);
  const pricesReady = V3_PLANS.every((plan) => v3Rows.rows.some((row) => row.plan === plan));
  const v4PricesReady = V4_REQUIRED.every(([plan, period]) =>
    v4Rows.rows.some((row) => row.plan === plan && row.period === period),
  );

  const common: string[] = [];
  if (!key) common.push("Stripe API credentials are missing");
  // A test key in production (or a live key outside it) disables checkout entirely.
  else if (stripeKeyProblem(stripeKeyMode(key), stripeDeploymentEnvironment()))
    common.push("Stripe credentials don’t match this deployment environment");
  if (!webhook) common.push("Stripe webhook signing secret is missing");
  if (!(await launchControls()).checkoutEnabled) common.push("Subscription checkout is disabled");
  if(!await sandboxAccepted()) common.push("Stripe sandbox lifecycle acceptance is pending");

  const blockers: string[] = [];
  if (!pricesReady) blockers.push("Monthly Stripe price mappings are incomplete");
  if (process.env.PRICING_V3_VALIDATED !== "true") blockers.push("Pricing acceptance is pending");

  const v4Blockers: string[] = [];
  if (!v4PricesReady) v4Blockers.push("v4 Stripe price mappings are incomplete");
  if (process.env.PRICING_V4_VALIDATED !== "true") v4Blockers.push("v4 pricing acceptance is pending");

  return {
    connected: Boolean(key),
    pricesReady,
    checkoutEnabled: [...common, ...blockers].length === 0,
    blockers: [...common, ...blockers],
    v4PricesReady,
    v4CheckoutEnabled: [...common, ...v4Blockers].length === 0,
    v4Blockers: [...common, ...v4Blockers],
  };
}
