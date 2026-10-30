import { getPool } from "./db";
import { integrationValue } from "./platform-settings";
export async function billingReadiness() {
  const [key, webhook, mappings] = await Promise.all([
    integrationValue("STRIPE_SECRET_KEY"), integrationValue("STRIPE_WEBHOOK_SECRET"),
    getPool().query("SELECT plan FROM private.subscription_prices WHERE period='monthly' AND plan IN ('individual','team','team_extra')"),
  ]);
  const pricesReady = ["individual", "team", "team_extra"].every((plan) => mappings.rows.some((row) => row.plan === plan));
  return { connected: Boolean(key), pricesReady, checkoutEnabled: process.env.BILLING_CHECKOUT_ENABLED === "true" && Boolean(key && webhook && pricesReady) };
}
