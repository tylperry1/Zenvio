import Stripe from "stripe";
import { integrationValue } from "./platform-settings";
import { ApiError } from "./server";
import { stripeEnvironmentForKey } from "./pricing-v4-catalog.mjs";
export async function stripeClient() {
  const key = await integrationValue("STRIPE_SECRET_KEY");
  if (!key) throw new ApiError("Online billing isn’t available right now. Please try again later or contact support.", 503);
  return new Stripe(key, { timeout: 15000, maxNetworkRetries: 2 });
}
/** "test" or "live" for the connected Stripe key. Never returns the key itself. */
export async function stripeEnvironment(): Promise<"test" | "live" | "unknown"> {
  return stripeEnvironmentForKey(await integrationValue("STRIPE_SECRET_KEY")) as
    | "test"
    | "live"
    | "unknown";
}
