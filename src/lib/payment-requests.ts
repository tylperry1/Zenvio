import { getPool } from "./db";
import { stripeClient } from "./billing";
import { appointmentPaymentsReady } from "./appointment-payments";
import { appOrigin } from "./lifecycle";
import { ApiError } from "./server";

// Deposit and final-payment requests for jobs. They reuse the host's existing Stripe Connect
// account and the platform's Stripe credentials; no separate payment system is introduced.
// A Checkout session is created only when the customer chooses to pay, and paid status is
// confirmed by reading the session back from Stripe, never assumed.

export async function paymentRequestReadiness(userId: string) {
  if (!(await appointmentPaymentsReady()))
    return { ready: false, reason: "Online payments aren’t enabled on this platform yet." };
  const account = (
    await getPool().query(
      "SELECT account_id,charges_enabled FROM private.host_payment_accounts WHERE user_id=$1 AND disconnected_at IS NULL",
      [userId],
    )
  ).rows[0];
  if (!account) return { ready: false, reason: "Connect a Stripe account on the Payments page to collect payments." };
  if (!account.charges_enabled) return { ready: false, reason: "Finish Stripe onboarding on the Payments page to accept payments." };
  return { ready: true, account: account.account_id as string };
}

export async function checkoutForRequest(requestId: string, scope: { userId: string; contactId: string; email: string; portalToken: string }) {
  const db = await getPool().connect();
  try {
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["payment-request:" + requestId]);
  const r = (
    await db.query(
      `SELECT r.*,j.title job_title FROM private.payment_requests r JOIN private.jobs j ON j.id=r.job_id
        WHERE r.id=$1 AND r.user_id=$2 AND j.contact_id=$3 FOR UPDATE OF r`,
      [requestId, scope.userId, scope.contactId],
    )
  ).rows[0];
  if (!r) throw new ApiError("Payment request not found.", 404);
  if (r.status !== "requested") throw new ApiError("This payment request is no longer open.", 409);
  const ready = await paymentRequestReadiness(scope.userId);
  if (!ready.ready) throw new ApiError(ready.reason!, 503);
  const stripe = await stripeClient();
  if (r.checkout_id) {
    const existing = await stripe.checkout.sessions.retrieve(r.checkout_id, {}, {stripeAccount: ready.account});
    if (existing.metadata?.zenvio_payment_request !== r.id || existing.amount_total !== r.amount_cents || existing.currency !== r.currency)
      throw new ApiError("Payment request requires billing review.",409);
    if (existing.status === "open" && existing.url) {
      await db.query("COMMIT");
      return existing.url;
    }
    if (existing.status !== "expired")
      throw new ApiError("This payment is processing or complete. Refresh its status before trying again.",409);
  }
  const feeBps = Number(process.env.CONNECT_FEE_BPS || 0);
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000)
    throw new ApiError("Platform commission configuration requires review.", 503);
  const back = `${appOrigin()}/portal/${scope.portalToken}`;
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      allowed_payment_method_types: ["card"],
      customer_email: scope.email,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      metadata: { zenvio_payment_request: r.id },
      payment_intent_data: {
        metadata: { zenvio_payment_request: r.id },
        ...(feeBps ? { application_fee_amount: Math.floor((r.amount_cents * feeBps) / 10000) } : {}),
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: r.currency,
            unit_amount: r.amount_cents,
            product_data: { name: `${r.job_title} · ${r.description}` },
          },
        },
      ],
      success_url: back + "?payment=processing",
      cancel_url: back + "?payment=cancelled",
    },
    { stripeAccount: ready.account, idempotencyKey: `payment-request-${r.id}-${r.checkout_id || "initial"}` },
  );
  await db.query("UPDATE private.payment_requests SET checkout_id=$2,checkout_url=$3 WHERE id=$1", [r.id, session.id, session.url]);
  await db.query("COMMIT");
  return session.url as string;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
}

// Confirms open requests with Stripe. Only a completed, paid session marks a request paid.
export async function syncPaymentRequests(userId: string, jobId?: string) {
  const { rows } = await getPool().query(
    `SELECT r.id,r.checkout_id,a.account_id FROM private.payment_requests r
       JOIN private.host_payment_accounts a ON a.user_id=r.user_id
      WHERE r.user_id=$1 AND r.status='requested' AND r.checkout_id IS NOT NULL ${jobId ? "AND r.job_id=$2" : ""} LIMIT 20`,
    jobId ? [userId, jobId] : [userId],
  );
  if (!rows.length) return;
  let stripe;
  try {
    stripe = await stripeClient();
  } catch {
    return;
  }
  for (const r of rows) {
    try {
      const session = await stripe.checkout.sessions.retrieve(r.checkout_id, {}, { stripeAccount: r.account_id });
      if (session.status === "complete" && session.payment_status === "paid" && session.metadata?.zenvio_payment_request === r.id) {
        const updated = await getPool().query(
          "UPDATE private.payment_requests SET status='paid',paid_at=now() WHERE id=$1 AND status='requested' RETURNING job_id,description,amount_cents",
          [r.id],
        );
        if (updated.rows[0])
          await getPool().query("INSERT INTO private.job_activity(job_id,action) VALUES($1,$2)", [
            updated.rows[0].job_id,
            `Payment received: ${updated.rows[0].description} ($${(updated.rows[0].amount_cents / 100).toFixed(2)})`,
          ]);
      }
    } catch {
      // Leave the request open; the next view retries.
    }
  }
}

