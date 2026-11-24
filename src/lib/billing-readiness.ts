import { launchControls, sandboxAccepted } from "./launch-controls";
import { databaseConfigured, getPool } from "./db";
import { integrationValue } from "./platform-settings";
import { stripeDeploymentEnvironment, stripeKeyMode, stripeKeyProblem } from "./stripe-environment";
import { CATALOG_ID, EXTRA_SEAT, PLANS } from "./pricing-catalog.mjs";

/**
 * One paid-checkout readiness check.
 *
 * Ready means: a Stripe key that matches this deployment, a webhook signing
 * secret, every plan mapped in Stripe for both periods, the launch checkout
 * switch on, a recorded Stripe test acceptance, and the single billing
 * validation flag. Anything missing closes checkout.
 */
const REQUIRED = [
  ...PLANS.filter((plan) => plan.paid && !plan.custom).flatMap((plan) => [
    [plan.id, "monthly"],
    [plan.id, "annual"],
  ]),
  [EXTRA_SEAT.id, "monthly"],
  [EXTRA_SEAT.id, "annual"],
] as [string, string][];

const unavailable = (reason: string) => ({
  connected: false,
  pricesReady: false,
  checkoutEnabled: false,
  blockers: [reason],
});

export async function billingReadiness() {
  if (!databaseConfigured()) return unavailable("Account database isn’t available");

  const [key, webhook, mappings] = await Promise.all([
    integrationValue("STRIPE_SECRET_KEY"),
    integrationValue("STRIPE_WEBHOOK_SECRET"),
    getPool().query(
      "SELECT plan, period FROM private.subscription_prices WHERE catalog_version=$1 AND plan = ANY($2::text[])",
      [CATALOG_ID, REQUIRED.map(([plan]) => plan)],
    ),
  ]);
  const pricesReady = REQUIRED.every(([plan, period]) =>
    mappings.rows.some((row) => row.plan === plan && row.period === period),
  );

  const blockers: string[] = [];
  if (!key) blockers.push("Stripe API credentials are missing");
  else if (stripeKeyProblem(stripeKeyMode(key), stripeDeploymentEnvironment()))
    blockers.push("Stripe credentials don’t match this deployment environment");
  if (!webhook) blockers.push("Stripe webhook signing secret is missing");
  if (!pricesReady) blockers.push("Stripe price mappings are incomplete");
  if (process.env.BILLING_VALIDATED !== "true")
    blockers.push("Billing acceptance is pending");
  if (!(await launchControls()).checkoutEnabled) blockers.push("Subscription checkout is disabled");
  if (!(await sandboxAccepted())) blockers.push("Stripe sandbox acceptance is pending");

  return {
    connected: Boolean(key),
    pricesReady,
    checkoutEnabled: blockers.length === 0,
    blockers,
  };
}
