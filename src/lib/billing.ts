import Stripe from "stripe";
import { integrationValue } from "./platform-settings";
import { ApiError } from "./server";
import { stripeEnvironmentForKey } from "./pricing-catalog.mjs";
import {
  stripeDeploymentEnvironment,
  stripeKeyMode,
  stripeKeyProblem,
} from "./stripe-environment";

const unavailable = () =>
  new ApiError(
    "Online billing isn’t available right now. Please try again later or contact support.",
    503,
  );

export async function stripeClient() {
  const key = await integrationValue("STRIPE_SECRET_KEY");
  if (!key) throw unavailable();
  // Fail closed when the secret’s mode does not match this deployment: a live key
  // must never charge from a preview, and production must never take test payments.
  const problem = stripeKeyProblem(stripeKeyMode(key), stripeDeploymentEnvironment());
  if (problem) {
    // Operational signal only. The key itself is never logged or returned.
    console.error("Stripe billing disabled: " + problem);
    throw unavailable();
  }
  return new Stripe(key, { timeout: 15000, maxNetworkRetries: 2 });
}
/** "test" or "live" for the connected Stripe key. Never returns the key itself. */
export async function stripeEnvironment(): Promise<"test" | "live" | "unknown"> {
  return stripeEnvironmentForKey(await integrationValue("STRIPE_SECRET_KEY")) as
    | "test"
    | "live"
    | "unknown";
}
