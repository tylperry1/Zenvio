import { getPool } from "./db";
import { stripeClient } from "./billing";
import { saveSubscription } from "./subscription-management";
import { failAddon, failAddonPayment, refundAddon, settleAddon } from "./subscription-addons";
import type { StripeWebhookDeps } from "./stripe-webhook";

/** Production dependencies for the Stripe webhook processor. */
export async function stripeWebhookDeps(): Promise<StripeWebhookDeps> {
  const stripe = await stripeClient();
  return {
    connect: () => getPool().connect(),
    stripe,
    saveSubscription,
    settleAddon,
    refundAddon,
    failAddon,
    failAddonPayment,
  };
}
