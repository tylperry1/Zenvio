import Stripe from "stripe";
import { integrationValue } from "./platform-settings";
import { ApiError } from "./server";
export async function stripeClient() {
  const key = await integrationValue("STRIPE_SECRET_KEY");
  if (!key) throw new ApiError("Billing management isn’t available right now. Your current access is unchanged.", 503);
  return new Stripe(key, { timeout: 15000, maxNetworkRetries: 2 });
}
