import { launchControls,sandboxAccepted } from "./launch-controls";
import { getPool } from "./db";
import { integrationValue } from "./platform-settings";
export async function billingReadiness() {
  const catalog=await (await import("./billing-catalog")).currentCatalog();
  const [key, webhook, mappings] = await Promise.all([
    integrationValue("STRIPE_SECRET_KEY"), integrationValue("STRIPE_WEBHOOK_SECRET"),
    getPool().query("SELECT plan FROM private.subscription_prices WHERE catalog_version=$1 AND period='monthly' AND plan IN ('individual','team','team_extra')", [catalog.version]),
  ]);
  const pricesReady = ["individual", "team", "team_extra"].every((plan) => mappings.rows.some((row) => row.plan === plan));
  const blockers: string[] = [];
  if (!key) blockers.push("Stripe API credentials are missing");
  if (!webhook) blockers.push("Stripe webhook signing secret is missing");
  if (!pricesReady) blockers.push("Monthly Stripe price mappings are incomplete");
  if (process.env.PRICING_V3_VALIDATED !== "true") blockers.push("Pricing acceptance is pending");
  if (!(await launchControls()).checkoutEnabled) blockers.push("Subscription checkout is disabled");
  if(!await sandboxAccepted()) blockers.push("Stripe sandbox lifecycle acceptance is pending");
  return { connected: Boolean(key), pricesReady, checkoutEnabled: blockers.length === 0, blockers };
}
