import type Stripe from "stripe";
import type { PoolClient } from "pg";

/**
 * Stripe webhook processor.
 *
 * - Every delivery is recorded in private.stripe_webhook_events before business
 *   changes happen, so failures stay visible and can be retried by an admin.
 * - Duplicate deliveries are acknowledged without applying the event twice.
 * - Subscription state is always re-read from Stripe instead of trusting the
 *   event snapshot, so out-of-order deliveries converge on the live contract.
 * - Add-on credits are only granted from a verified Checkout Session/PaymentIntent.
 */

export type StripeWebhookDeps = {
  connect: () => Promise<PoolClient>;
  stripe: Stripe;
  saveSubscription: (
    client: PoolClient,
    subscription: Stripe.Subscription,
    userId: string,
  ) => Promise<void>;
  settleAddon: (client: PoolClient, session: Stripe.Checkout.Session) => Promise<boolean>;
  refundAddon: (client: PoolClient, charge: Stripe.Charge) => Promise<boolean>;
};

export type StripeEventOutcome = "processed" | "ignored";

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

const INVOICE_EVENTS = new Set([
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
]);

const CHECKOUT_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

const RETRIEVABLE_EVENTS: Record<string, string> = {
  "checkout.session.completed": "checkout.session",
  "checkout.session.async_payment_succeeded": "checkout.session",
  "customer.subscription.created": "subscription",
  "customer.subscription.updated": "subscription",
  "customer.subscription.deleted": "subscription",
  "customer.subscription.paused": "subscription",
  "customer.subscription.resumed": "subscription",
  "invoice.paid": "invoice",
  "invoice.payment_succeeded": "invoice",
  "invoice.payment_failed": "invoice",
  "payment_intent.succeeded": "payment_intent",
  "charge.refunded": "charge",
  "customer.updated": "customer",
};

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Stripe event processing failed.";
  return message.replace(/\s+/g, " ").slice(0, 300);
}

function idOf(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

export function eventObjectId(event: Stripe.Event): string | null {
  return idOf((event.data?.object as { id?: string } | undefined)?.id);
}

/** Stripe moved this field under parent.subscription_details in newer API versions. */
export function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const compat = invoice as Stripe.Invoice & {
    subscription?: string | { id: string } | null;
    parent?: {
      subscription_details?: { subscription?: string | { id: string } | null } | null;
    } | null;
  };
  return (
    idOf(compat.subscription) ??
    idOf(compat.parent?.subscription_details?.subscription)
  );
}

export function isRetrievableEvent(type: string) {
  return Object.hasOwn(RETRIEVABLE_EVENTS, type);
}

/** Retrieve the current provider object for an admin retry. */
export async function retrieveEventObject(
  type: string,
  objectId: string,
  stripe: Stripe,
): Promise<unknown> {
  switch (RETRIEVABLE_EVENTS[type]) {
    case "checkout.session":
      return stripe.checkout.sessions.retrieve(objectId);
    case "subscription":
      return stripe.subscriptions.retrieve(objectId, { expand: ["discounts"] });
    case "invoice":
      return stripe.invoices.retrieve(objectId);
    case "payment_intent":
      return stripe.paymentIntents.retrieve(objectId);
    case "charge":
      return stripe.charges.retrieve(objectId);
    case "customer":
      return stripe.customers.retrieve(objectId);
    default:
      return null;
  }
}

async function syncVerifiedSubscription(
  subscriptionId: string,
  client: PoolClient,
  deps: StripeWebhookDeps,
) {
  let subscription: Stripe.Subscription;
  try {
    subscription = await deps.stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["discounts"],
    });
  } catch (error) {
    // A deleted provider subscription can still be retrieved; a genuinely missing
    // one must not keep retrying forever.
    if ((error as { code?: string }).code === "resource_missing") return "ignored";
    throw error;
  }

  const customerId = idOf(subscription.customer);
  const owner = (
    await client.query("SELECT user_id FROM private.subscriptions WHERE customer_id=$1", [
      customerId,
    ])
  ).rows[0]?.user_id as string | undefined;

  // Not a Zenvio SaaS subscription (marketplace or another product): nothing to sync.
  if (!owner) return "ignored";

  const metadataUser = subscription.metadata?.user_id;
  if (metadataUser && metadataUser !== owner) {
    throw new Error("Billing account ownership could not be verified.");
  }
  await deps.saveSubscription(client, subscription, owner);
  return "processed";
}

async function reconcileCheckoutRefund(
  client: PoolClient,
  checkout: Stripe.Checkout.Session,
  deps: StripeWebhookDeps,
) {
  const intentId = idOf(checkout.payment_intent);
  if (!intentId) return;
  const intent = await deps.stripe.paymentIntents.retrieve(intentId);
  const chargeId = idOf(intent.latest_charge);
  if (!chargeId) return;
  const charge = await deps.stripe.charges.retrieve(chargeId);
  if (charge.amount_refunded > 0) await deps.refundAddon(client, charge);
}

async function handleEvent(
  event: Stripe.Event,
  client: PoolClient,
  deps: StripeWebhookDeps,
): Promise<StripeEventOutcome> {
  if (CHECKOUT_EVENTS.has(event.type)) {
    const snapshot = event.data.object as Stripe.Checkout.Session;
    if (snapshot.metadata?.zenvio_addon_order) {
      const checkout = await deps.stripe.checkout.sessions.retrieve(snapshot.id);
      await deps.settleAddon(client, checkout);
      await reconcileCheckoutRefund(client, checkout, deps);
      return "processed";
    }
    if (snapshot.mode === "subscription") {
      const subscriptionId = idOf(snapshot.subscription);
      // Checkout completion never grants entitlements by itself; the live
      // subscription status is the source of truth.
      if (!subscriptionId) return "ignored";
      return syncVerifiedSubscription(subscriptionId, client, deps);
    }
    return "ignored";
  }

  if (SUBSCRIPTION_EVENTS.has(event.type)) {
    const subscription = event.data.object as Stripe.Subscription;
    return syncVerifiedSubscription(subscription.id, client, deps);
  }

  if (INVOICE_EVENTS.has(event.type)) {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = invoiceSubscriptionId(invoice);
    if (!subscriptionId) return "ignored";
    // A failed invoice leaves the subscription past_due; reading the live
    // subscription records that state without ever claiming a successful payment.
    return syncVerifiedSubscription(subscriptionId, client, deps);
  }

  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object as Stripe.PaymentIntent;
    const orderId = intent.metadata?.zenvio_addon_order;
    if (!orderId) return "ignored";
    const order = (
      await client.query(
        "SELECT checkout_id,state FROM private.subscription_addon_orders WHERE id=$1",
        [orderId],
      )
    ).rows[0] as { checkout_id?: string | null; state?: string } | undefined;
    // Idempotent: a paid order is already fulfilled, and fulfillment requires
    // the exact stored Checkout Session that settleAddon verifies.
    if (!order?.checkout_id || order.state !== "pending") return "ignored";
    const checkout = await deps.stripe.checkout.sessions.retrieve(order.checkout_id);
    await deps.settleAddon(client, checkout);
    return "processed";
  }

  if (event.type === "charge.refunded") {
    const charge = await deps.stripe.charges.retrieve(
      (event.data.object as Stripe.Charge).id,
    );
    const intentId = idOf(charge.payment_intent);
    if (!intentId) return "ignored";
    const order = (
      await client.query(
        "SELECT id FROM private.subscription_addon_orders WHERE payment_intent_id=$1",
        [intentId],
      )
    ).rows[0];
    if (!order) return "ignored";
    await deps.refundAddon(client, charge);
    return "processed";
  }

  // Customer updates are recorded for visibility but never rewrite billing identity.
  if (event.type === "customer.updated") return "ignored";

  return "ignored";
}

export async function processStripeEvent(
  event: Stripe.Event,
  deps: StripeWebhookDeps,
): Promise<{ duplicate: boolean; outcome?: StripeEventOutcome }> {
  const client = await deps.connect();
  try {
    // Claim the delivery. Committing the claim first keeps the failure record
    // durable even when the business transaction rolls back.
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "stripe-event:" + event.id,
    ]);
    const prior = (
      await client.query(
        "SELECT status FROM private.stripe_webhook_events WHERE id=$1 FOR UPDATE",
        [event.id],
      )
    ).rows[0] as { status?: string } | undefined;
    if (prior?.status === "processed" || prior?.status === "ignored") {
      await client.query("COMMIT");
      return { duplicate: true };
    }
    await client.query(
      `INSERT INTO private.stripe_webhook_events(id,type,object_id,status,attempts,livemode)
       VALUES($1,$2,$3,'processing',1,$4)
       ON CONFLICT(id) DO UPDATE
         SET status='processing',attempts=private.stripe_webhook_events.attempts+1,
             error=NULL,updated_at=now()`,
      [event.id, event.type, eventObjectId(event), event.livemode === true],
    );
    await client.query("COMMIT");

    await client.query("BEGIN");
    let outcome: StripeEventOutcome;
    try {
      outcome = await handleEvent(event, client, deps);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    await client.query(
      `UPDATE private.stripe_webhook_events
          SET status=$2,error=NULL,processed_at=now(),updated_at=now()
        WHERE id=$1`,
      [event.id, outcome],
    );
    // Keep the legacy delivery marker so older reconciliation tooling still works.
    await client.query(
      "INSERT INTO private.stripe_events(id) VALUES($1) ON CONFLICT DO NOTHING",
      [event.id],
    );
    await client.query("COMMIT");
    return { duplicate: false, outcome };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* transaction already closed */
    }
    try {
      await client.query(
        `UPDATE private.stripe_webhook_events
            SET status='failed',error=$2,updated_at=now()
          WHERE id=$1`,
        [event.id, safeError(error)],
      );
    } catch {
      /* keep the original failure */
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function listStripeWebhookEvents(
  db: Pick<PoolClient, "query">,
  limit = 50,
) {
  return (
    await db.query(
      `SELECT id,type,object_id,status,attempts,error,livemode,received_at,processed_at
         FROM private.stripe_webhook_events
        ORDER BY received_at DESC
        LIMIT $1`,
      [Math.min(200, Math.max(1, limit))],
    )
  ).rows as {
    id: string;
    type: string;
    object_id: string | null;
    status: string;
    attempts: number;
    error: string | null;
    livemode: boolean | null;
    received_at: string;
    processed_at: string | null;
  }[];
}

/** Reprocess a failed delivery using the current Stripe object. */
export async function retryStripeWebhookEvent(
  db: Pick<PoolClient, "query">,
  eventId: string,
  deps: StripeWebhookDeps,
) {
  const row = (
    await db.query(
      "SELECT id,type,object_id,status FROM private.stripe_webhook_events WHERE id=$1",
      [eventId],
    )
  ).rows[0] as
    | { id: string; type: string; object_id: string | null; status: string }
    | undefined;
  if (!row) throw new Error("Webhook event not found.");
  if (row.status === "processed") return { ok: true, alreadyProcessed: true };
  if (!row.object_id || !isRetrievableEvent(row.type)) {
    throw new Error("This webhook event cannot be retried automatically.");
  }
  const object = await retrieveEventObject(row.type, row.object_id, deps.stripe);
  if (!object) throw new Error("The Stripe object no longer exists.");
  const event = {
    id: row.id,
    type: row.type,
    data: { object },
  } as unknown as Stripe.Event;
  const result = await processStripeEvent(event, deps);
  return { ok: true, alreadyProcessed: result.duplicate === true, outcome: result.outcome };
}
