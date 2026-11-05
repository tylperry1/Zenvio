import { getPool } from "./db";
import { integrationValue } from "./platform-settings";
export async function billingReadiness() {
  const [key, webhook, mappings] = await Promise.all([
    integrationValue("STRIPE_SECRET_KEY"), integrationValue("STRIPE_WEBHOOK_SECRET"),
    getPool().query("SELECT plan FROM private.subscription_prices WHERE catalog_version='2026-11-v3' AND period='monthly' AND plan IN ('individual','team','team_extra')"),
  ]);
  const pricesReady = ["individual", "team", "team_extra"].every((plan) => mappings.rows.some((row) => row.plan === plan));
  const blockers: string[] = [];
  if (!key) blockers.push("Stripe API credentials are missing");
  if (!webhook) blockers.push("Stripe webhook signing secret is missing");
  if (!pricesReady) blockers.push("Monthly Stripe price mappings are incomplete");
  if (process.env.PRICING_V3_VALIDATED !== "true") blockers.push("Pricing acceptance is pending");
  if (process.env.BILLING_CHECKOUT_ENABLED !== "true") blockers.push("Subscription checkout is disabled");
  return { connected: Boolean(key), pricesReady, checkoutEnabled: blockers.length === 0, blockers };
}
