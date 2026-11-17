import type Stripe from "stripe";
import { getPool } from "./db";
import { stripeClient } from "./billing";
import { saveSubscription } from "./subscription-management";
import { ApiError } from "./server";

export type SyncKind = "stripe_subscriptions" | "stripe_invoices" | "full";

/** Stripe Invoice shape varies across API versions; read optional fields safely. */
type InvoiceCompat = Stripe.Invoice & {
  paid?: boolean | null;
  charge?: string | Stripe.Charge | null;
  subscription?: string | { id: string } | null;
  parent?: {
    subscription_details?: { subscription?: string | { id: string } | null } | null;
  } | null;
};

function invoiceRefundedCents(invoice: InvoiceCompat) {
  const charge = invoice.charge;
  if (charge && typeof charge !== "string" && typeof charge.amount_refunded === "number") {
    return charge.amount_refunded;
  }
  return 0;
}

function invoiceSubscriptionId(invoice: InvoiceCompat) {
  const direct = invoice.subscription;
  if (typeof direct === "string") return direct;
  if (direct && typeof direct === "object" && "id" in direct) return direct.id;
  const parent = invoice.parent?.subscription_details?.subscription;
  if (typeof parent === "string") return parent;
  if (parent && typeof parent === "object" && "id" in parent) return parent.id;
  return null;
}

function invoicePaid(invoice: InvoiceCompat) {
  return Boolean(invoice.paid || invoice.status === "paid");
}

function classifyInvoice(invoice: InvoiceCompat): string {
  if (invoice.status === "void") return "void";
  if (invoice.status === "uncollectible") return "uncollectible";
  if (invoiceRefundedCents(invoice) > 0 && invoicePaid(invoice)) return "refunded";
  if (invoicePaid(invoice)) return "cash";
  if (invoice.status === "open") return "open";
  if (invoice.status === "draft") return "unknown";
  return "failed";
}

async function startRun(kind: SyncKind, actorId: string | null) {
  const db = getPool();
  const { rows } = await db.query(
    `INSERT INTO private.financial_sync_runs(kind,status,actor_id)
     VALUES($1,'running',$2) RETURNING id`,
    [kind, actorId],
  );
  return rows[0].id as string;
}

async function finishRun(
  id: string,
  status: "succeeded" | "failed" | "partial",
  processed: number,
  failed: number,
  details: Record<string, unknown>,
  error?: string,
) {
  await getPool().query(
    `UPDATE private.financial_sync_runs
     SET status=$2, finished_at=now(), processed=$3, failed=$4, details=$5, error=$6
     WHERE id=$1`,
    [id, status, processed, failed, JSON.stringify(details), error || null],
  );
}

/** Reconcile local subscription + revenue snapshots from live Stripe subscription objects. */
export async function reconcileStripeSubscriptions(actorId: string | null) {
  const stripe = await stripeClient();
  const runId = await startRun("stripe_subscriptions", actorId);
  const db = getPool();
  let processed = 0;
  let failed = 0;
  const errors: string[] = [];
  try {
    const { rows } = await db.query(
      `SELECT user_id, subscription_id, customer_id
       FROM private.subscriptions
       WHERE subscription_id IS NOT NULL
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 500`,
    );
    for (const row of rows) {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `subscription:${row.subscription_id}`,
        ]);
        const subscription = await stripe.subscriptions.retrieve(row.subscription_id, {
          expand: ["discounts"],
        });
        const customer =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id;
        if (customer !== row.customer_id) {
          throw new Error("Customer mismatch for subscription " + row.subscription_id);
        }
        await saveSubscription(client, subscription, row.user_id);
        await client.query("COMMIT");
        processed += 1;
      } catch (e) {
        await client.query("ROLLBACK");
        failed += 1;
        errors.push(
          `${row.subscription_id}: ${e instanceof Error ? e.message : "reconcile failed"}`,
        );
      } finally {
        client.release();
      }
    }
    // Mark Stripe provider sync state.
    await db.query(
      `INSERT INTO private.provider_cost_sync_state(provider, connection_status, last_sync_at, last_error, updated_at)
       VALUES('stripe','connected',now(),$1,now())
       ON CONFLICT(provider) DO UPDATE
       SET connection_status='connected', last_sync_at=now(), last_error=$1, updated_at=now()`,
      [failed ? `${failed} subscription reconcile error(s)` : null],
    );
    const status = failed === 0 ? "succeeded" : processed > 0 ? "partial" : "failed";
    await finishRun(runId, status, processed, failed, {
      kind: "stripe_subscriptions",
      errors: errors.slice(0, 25),
    }, failed ? errors[0] : undefined);
    return { runId, processed, failed, status, errors: errors.slice(0, 25) };
  } catch (e) {
    await finishRun(
      runId,
      "failed",
      processed,
      failed,
      { kind: "stripe_subscriptions" },
      e instanceof Error ? e.message : "Subscription sync failed",
    );
    throw e;
  }
}

async function upsertInvoice(
  invoice: Stripe.Invoice,
  userId: string | null,
) {
  const row = invoice as InvoiceCompat;
  const customer =
    typeof row.customer === "string"
      ? row.customer
      : row.customer?.id;
  if (!customer) return;
  const subscription = invoiceSubscriptionId(row);
  const paid = invoicePaid(row);
  const paidAt = row.status_transitions?.paid_at
    ? new Date(row.status_transitions.paid_at * 1000)
    : paid && row.created
      ? new Date(row.created * 1000)
      : null;
  const refunded = invoiceRefundedCents(row);
  await getPool().query(
    `INSERT INTO private.financial_invoice_snapshots(
       stripe_invoice_id,user_id,customer_id,status,billing_reason,currency,
       amount_paid_cents,amount_due_cents,amount_remaining_cents,amount_refunded_cents,
       subtotal_cents,total_cents,subscription_id,paid,attempted,
       created_at,paid_at,period_start,period_end,hosted_invoice_url,classification,reconciled_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,now()
     )
     ON CONFLICT(stripe_invoice_id) DO UPDATE SET
       user_id=EXCLUDED.user_id,
       status=EXCLUDED.status,
       billing_reason=EXCLUDED.billing_reason,
       amount_paid_cents=EXCLUDED.amount_paid_cents,
       amount_due_cents=EXCLUDED.amount_due_cents,
       amount_remaining_cents=EXCLUDED.amount_remaining_cents,
       amount_refunded_cents=EXCLUDED.amount_refunded_cents,
       subtotal_cents=EXCLUDED.subtotal_cents,
       total_cents=EXCLUDED.total_cents,
       subscription_id=EXCLUDED.subscription_id,
       paid=EXCLUDED.paid,
       attempted=EXCLUDED.attempted,
       paid_at=EXCLUDED.paid_at,
       period_start=EXCLUDED.period_start,
       period_end=EXCLUDED.period_end,
       hosted_invoice_url=EXCLUDED.hosted_invoice_url,
       classification=EXCLUDED.classification,
       reconciled_at=now()`,
    [
      row.id,
      userId,
      customer,
      row.status,
      row.billing_reason || null,
      row.currency || "usd",
      row.amount_paid || 0,
      row.amount_due || 0,
      row.amount_remaining || 0,
      refunded,
      row.subtotal ?? null,
      row.total ?? null,
      subscription,
      paid,
      Boolean(row.attempted),
      new Date(row.created * 1000),
      paidAt,
      row.period_start ? new Date(row.period_start * 1000) : null,
      row.period_end ? new Date(row.period_end * 1000) : null,
      row.hosted_invoice_url || null,
      classifyInvoice(row),
    ],
  );
}

/** Pull recent Stripe invoices for known customers into local cash snapshots. */
export async function reconcileStripeInvoices(actorId: string | null) {
  const stripe = await stripeClient();
  const runId = await startRun("stripe_invoices", actorId);
  const db = getPool();
  let processed = 0;
  let failed = 0;
  const errors: string[] = [];
  try {
    const { rows } = await db.query(
      `SELECT user_id, customer_id
       FROM private.subscriptions
       WHERE customer_id IS NOT NULL
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 400`,
    );
    for (const row of rows) {
      try {
        const page = await stripe.invoices.list({
          customer: row.customer_id,
          limit: 24,
          expand: ["data.charge"],
        });
        for (const invoice of page.data) {
          await upsertInvoice(invoice, row.user_id);
          processed += 1;
        }
      } catch (e) {
        failed += 1;
        errors.push(
          `${row.customer_id}: ${e instanceof Error ? e.message : "invoice sync failed"}`,
        );
      }
    }
    await db.query(
      `INSERT INTO private.provider_cost_sync_state(provider, connection_status, last_sync_at, last_error, updated_at)
       VALUES('stripe','connected',now(),$1,now())
       ON CONFLICT(provider) DO UPDATE
       SET connection_status='connected', last_sync_at=now(), last_error=COALESCE($1,private.provider_cost_sync_state.last_error), updated_at=now()`,
      [failed ? `${failed} invoice customer error(s)` : null],
    );
    const status = failed === 0 ? "succeeded" : processed > 0 ? "partial" : "failed";
    await finishRun(runId, status, processed, failed, {
      kind: "stripe_invoices",
      errors: errors.slice(0, 25),
    }, failed ? errors[0] : undefined);
    return { runId, processed, failed, status, errors: errors.slice(0, 25) };
  } catch (e) {
    await finishRun(
      runId,
      "failed",
      processed,
      failed,
      { kind: "stripe_invoices" },
      e instanceof Error ? e.message : "Invoice sync failed",
    );
    throw e;
  }
}

export async function runFinancialSync(kind: SyncKind, actorId: string | null) {
  if (kind === "stripe_subscriptions") return reconcileStripeSubscriptions(actorId);
  if (kind === "stripe_invoices") return reconcileStripeInvoices(actorId);
  if (kind === "full") {
    const runId = await startRun("full", actorId);
    try {
      const subs = await reconcileStripeSubscriptions(actorId);
      const invoices = await reconcileStripeInvoices(actorId);
      const failed = subs.failed + invoices.failed;
      const processed = subs.processed + invoices.processed;
      const status =
        failed === 0 ? "succeeded" : processed > 0 ? "partial" : "failed";
      await finishRun(runId, status, processed, failed, {
        subscriptions: subs,
        invoices,
      });
      return {
        runId,
        processed,
        failed,
        status,
        errors: [...subs.errors, ...invoices.errors].slice(0, 40),
        subscriptions: subs,
        invoices,
      };
    } catch (e) {
      await finishRun(
        runId,
        "failed",
        0,
        1,
        {},
        e instanceof Error ? e.message : "Full sync failed",
      );
      throw e;
    }
  }
  throw new ApiError("Unsupported financial sync kind.", 400);
}

export async function latestFinancialSyncRuns(limit = 8) {
  const { rows } = await getPool().query(
    `SELECT id, kind, status, started_at, finished_at, processed, failed, error, details
     FROM private.financial_sync_runs
     ORDER BY started_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows;
}
