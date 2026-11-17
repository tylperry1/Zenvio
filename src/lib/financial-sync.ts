import type Stripe from "stripe";
import { getPool } from "./db";
import { stripeClient } from "./billing";
import { saveSubscription } from "./subscription-management";
import { ApiError } from "./server";

export type SyncKind = "stripe_subscriptions" | "stripe_invoices" | "full";

/** Stripe Invoice shape varies across API versions; read optional fields safely. */
type InvoiceCompat = Stripe.Invoice & {
  paid?: boolean | null;
  subscription?: string | { id: string } | null;
  post_payment_credit_notes_amount?: number | null;
  payment_intent?: string | { id: string } | null;
  parent?: {
    subscription_details?: { subscription?: string | { id: string } | null } | null;
  } | null;
};

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

type InvoiceRefundEvent = {
  stripeRefundId: string;
  amountCents: number;
  refundedAt: Date;
};

type InvoiceRefundInfo = {
  cents: number;
  latestRefundAt: Date | null;
  events: InvoiceRefundEvent[];
  /** False when a refunds.list call failed or dated events under-count charge refunds. */
  eventsComplete: boolean;
  /** Refund ids observed as failed/canceled — drop any previously stored rows. */
  invalidateIds: string[];
};

/** Resolve refunded cents + dated refund events via invoice payments → PI → Charge (Stripe 23+). */
async function invoiceRefundInfo(
  stripe: Stripe,
  invoice: InvoiceCompat,
): Promise<InvoiceRefundInfo> {
  const creditNotes = Number(invoice.post_payment_credit_notes_amount || 0);
  let fromCharges = 0;
  let listFailures = 0;
  const events: InvoiceRefundEvent[] = [];
  const invalidateIds: string[] = [];
  const seen = new Set<string>();
  const paymentIntentIds = new Set<string>();
  const legacyPi = invoice.payment_intent;
  if (typeof legacyPi === "string") paymentIntentIds.add(legacyPi);
  else if (legacyPi && typeof legacyPi === "object" && legacyPi.id) paymentIntentIds.add(legacyPi.id);

  try {
    const payments = await stripe.invoicePayments.list({ invoice: invoice.id, limit: 20 });
    for (const payment of payments.data) {
      const pi = (payment as { payment?: { payment_intent?: string | { id: string } | null } | null })
        .payment?.payment_intent;
      if (typeof pi === "string") paymentIntentIds.add(pi);
      else if (pi && typeof pi === "object" && pi.id) paymentIntentIds.add(pi.id);
    }
  } catch {
    // invoicePayments may be unavailable on older accounts; fall through to PI / credit notes.
  }

  for (const intentId of paymentIntentIds) {
    try {
      const intent = await stripe.paymentIntents.retrieve(intentId);
      const chargeId =
        typeof intent.latest_charge === "string"
          ? intent.latest_charge
          : intent.latest_charge?.id;
      if (!chargeId) continue;
      const charge = await stripe.charges.retrieve(chargeId);
      fromCharges += Number(charge.amount_refunded || 0);
      try {
        const refunds = await stripe.refunds.list({ charge: chargeId, limit: 100 });
        for (const refund of refunds.data) {
          if (!refund.id || !refund.created) continue;
          const status = String(refund.status || "");
          if (status === "failed" || status === "canceled") {
            invalidateIds.push(refund.id);
            continue;
          }
          // Only succeeded refunds count toward cash (pending/requires_action stay out).
          if (status !== "succeeded") continue;
          const amountCents = Number(refund.amount || 0);
          if (amountCents <= 0 || seen.has(refund.id)) continue;
          seen.add(refund.id);
          events.push({
            stripeRefundId: refund.id,
            amountCents,
            refundedAt: new Date(refund.created * 1000),
          });
        }
      } catch {
        listFailures += 1;
      }
    } catch {
      // Keep aggregating remaining payment intents.
    }
  }

  const eventCents = events.reduce((n, e) => n + e.amountCents, 0);
  const eventsComplete =
    listFailures === 0 && (fromCharges === 0 || eventCents >= fromCharges || paymentIntentIds.size === 0);
  // Dated events are authoritative only when the list is complete; otherwise keep cumulative.
  let cents = Math.max(creditNotes, fromCharges);
  if (eventsComplete && eventCents > 0) cents = eventCents;
  if (eventsComplete && eventCents === 0 && creditNotes > fromCharges && creditNotes > 0) {
    events.push({
      stripeRefundId: `credit_note:${invoice.id}`,
      amountCents: creditNotes,
      refundedAt: new Date((invoice.status_transitions?.paid_at || invoice.created) * 1000),
    });
    cents = creditNotes;
  }

  const latestRefundAt =
    events.length > 0
      ? events.reduce((latest, e) => (e.refundedAt > latest ? e.refundedAt : latest), events[0].refundedAt)
      : null;
  return { cents, latestRefundAt, events, eventsComplete, invalidateIds };
}

function classifyInvoice(invoice: InvoiceCompat, refundedCents: number): string {
  if (invoice.status === "void") return "void";
  if (invoice.status === "uncollectible") return "uncollectible";
  if (refundedCents > 0 && invoicePaid(invoice)) return "refunded";
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

const PAGE = 200;

/** Reconcile local subscription + revenue snapshots from live Stripe subscription objects. */
export async function reconcileStripeSubscriptions(actorId: string | null) {
  const stripe = await stripeClient();
  const runId = await startRun("stripe_subscriptions", actorId);
  const db = getPool();
  let processed = 0;
  let failed = 0;
  let pages = 0;
  const errors: string[] = [];
  try {
    // Stable keyset by user_id so saveSubscription's updated_at bump cannot starve older rows.
    type SubRow = { user_id: string; subscription_id: string; customer_id: string };
    let afterUserId: string | null = null;
    for (;;) {
      const cursor = afterUserId;
      const pageResult = await db.query(
        `SELECT user_id, subscription_id, customer_id
         FROM private.subscriptions
         WHERE subscription_id IS NOT NULL
           AND ($1::uuid IS NULL OR user_id > $1::uuid)
         ORDER BY user_id ASC
         LIMIT $2`,
        [cursor, PAGE],
      );
      const rows = pageResult.rows as SubRow[];
      if (!rows.length) break;
      pages += 1;
      for (const row of rows) {
        afterUserId = row.user_id;
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
      if (rows.length < PAGE) break;
    }
    const connectionStatus = failed === 0 ? "connected" : processed > 0 ? "degraded" : "error";
    await db.query(
      `INSERT INTO private.provider_cost_sync_state(provider, connection_status, last_sync_at, last_error, updated_at)
       VALUES('stripe',$2,now(),$1,now())
       ON CONFLICT(provider) DO UPDATE
       SET connection_status=$2, last_sync_at=now(), last_error=$1, updated_at=now()`,
      [failed ? `${failed} subscription reconcile error(s)` : null, connectionStatus],
    );
    const status = failed === 0 ? "succeeded" : processed > 0 ? "partial" : "failed";
    const details = {
      kind: "stripe_subscriptions",
      pages,
      completeCoverage: failed === 0,
      errors: errors.slice(0, 25),
    };
    await finishRun(runId, status, processed, failed, details, failed ? errors[0] : undefined);
    return { runId, processed, failed, status, errors: errors.slice(0, 25), details };
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
  stripe: Stripe,
  invoice: Stripe.Invoice,
  userId: string | null,
): Promise<{ refundEventsIncomplete: boolean }> {
  const row = invoice as InvoiceCompat;
  const customer =
    typeof row.customer === "string"
      ? row.customer
      : row.customer?.id;
  if (!customer) return { refundEventsIncomplete: false };
  const subscription = invoiceSubscriptionId(row);
  const paid = invoicePaid(row);
  const paidAt = row.status_transitions?.paid_at
    ? new Date(row.status_transitions.paid_at * 1000)
    : paid && row.created
      ? new Date(row.created * 1000)
      : null;
  const refund = await invoiceRefundInfo(stripe, row);
  const currency = row.currency || "usd";
  const createdAt = new Date(row.created * 1000);
  // Stripe-sourced refund time only in $18. Insert falls back to paid_at/created when null.
  // Updates prefer a later Stripe timestamp (repairs estimated dates) and never invent now().
  const stripeRefundedAt = refund.latestRefundAt;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO private.financial_invoice_snapshots(
         stripe_invoice_id,user_id,customer_id,status,billing_reason,currency,
         amount_paid_cents,amount_due_cents,amount_remaining_cents,amount_refunded_cents,
         subtotal_cents,total_cents,subscription_id,paid,attempted,
         created_at,paid_at,refunded_at,period_start,period_end,hosted_invoice_url,classification,reconciled_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
         CASE WHEN $10::int > 0 THEN COALESCE($18::timestamptz, $17::timestamptz, $16::timestamptz) ELSE NULL END,
         $19,$20,$21,$22,now()
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
         refunded_at=CASE
           WHEN EXCLUDED.amount_refunded_cents <= 0 THEN private.financial_invoice_snapshots.refunded_at
           WHEN $18::timestamptz IS NOT NULL THEN $18::timestamptz
           ELSE COALESCE(private.financial_invoice_snapshots.refunded_at, EXCLUDED.paid_at)
         END,
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
        currency,
        row.amount_paid || 0,
        row.amount_due || 0,
        row.amount_remaining || 0,
        refund.cents,
        row.subtotal ?? null,
        row.total ?? null,
        subscription,
        paid,
        Boolean(row.attempted),
        createdAt,
        paidAt,
        stripeRefundedAt,
        row.period_start ? new Date(row.period_start * 1000) : null,
        row.period_end ? new Date(row.period_end * 1000) : null,
        row.hosted_invoice_url || null,
        classifyInvoice(row, refund.cents),
      ],
    );

    const hasRealRefundEvents = refund.events.some((e) => !e.stripeRefundId.startsWith("credit_note:"));
    if (hasRealRefundEvents) {
      // Atomically drop synthetic credit-note fallback so it cannot double-count with real refunds.
      await client.query(
        `DELETE FROM private.financial_invoice_refund_events
         WHERE stripe_refund_id = $1`,
        [`credit_note:${row.id}`],
      );
    }

    for (const event of refund.events) {
      await client.query(
        `INSERT INTO private.financial_invoice_refund_events(
           stripe_refund_id,stripe_invoice_id,currency,amount_cents,refunded_at,reconciled_at
         ) VALUES ($1,$2,$3,$4,$5,now())
         ON CONFLICT(stripe_refund_id) DO UPDATE SET
           amount_cents=EXCLUDED.amount_cents,
           refunded_at=EXCLUDED.refunded_at,
           currency=EXCLUDED.currency,
           reconciled_at=now()`,
        [event.stripeRefundId, row.id, currency, event.amountCents, event.refundedAt],
      );
    }

    if (refund.invalidateIds.length) {
      await client.query(
        `DELETE FROM private.financial_invoice_refund_events
         WHERE stripe_refund_id = ANY($1::text[])`,
        [refund.invalidateIds],
      );
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return { refundEventsIncomplete: !refund.eventsComplete };
}

/** Pull Stripe invoices for known customers into local cash snapshots (paginated). */
export async function reconcileStripeInvoices(actorId: string | null) {
  const stripe = await stripeClient();
  const runId = await startRun("stripe_invoices", actorId);
  const db = getPool();
  let processed = 0;
  let failed = 0;
  let customersTotal = 0;
  let customersSynced = 0;
  let truncated = false;
  let incompleteRefundLookups = 0;
  const errors: string[] = [];
  try {
    type CustRow = { user_id: string; customer_id: string };
    let afterUserId: string | null = null;
    for (;;) {
      const cursor = afterUserId;
      const pageResult = await db.query(
        `SELECT user_id, customer_id
         FROM private.subscriptions
         WHERE customer_id IS NOT NULL
           AND ($1::uuid IS NULL OR user_id > $1::uuid)
         ORDER BY user_id ASC
         LIMIT $2`,
        [cursor, PAGE],
      );
      const rows = pageResult.rows as CustRow[];
      if (!rows.length) break;
      customersTotal += rows.length;
      for (const row of rows) {
        afterUserId = row.user_id;
        try {
          let startingAfter: string | undefined;
          for (;;) {
            const page = await stripe.invoices.list({
              customer: row.customer_id,
              limit: 100,
              ...(startingAfter ? { starting_after: startingAfter } : {}),
            });
            for (const invoice of page.data) {
              const result = await upsertInvoice(stripe, invoice, row.user_id);
              if (result.refundEventsIncomplete) {
                incompleteRefundLookups += 1;
                truncated = true;
              }
              processed += 1;
            }
            if (!page.has_more || !page.data.length) break;
            startingAfter = page.data[page.data.length - 1].id;
          }
          customersSynced += 1;
        } catch (e) {
          failed += 1;
          truncated = true;
          errors.push(
            `${row.customer_id}: ${e instanceof Error ? e.message : "invoice sync failed"}`,
          );
        }
      }
      if (rows.length < PAGE) break;
    }
    const completeCoverage =
      failed === 0 && !truncated && incompleteRefundLookups === 0 && customersTotal === customersSynced;
    const connectionStatus = completeCoverage
      ? "connected"
      : failed === 0 || processed > 0
        ? "degraded"
        : "error";
    await db.query(
      `INSERT INTO private.provider_cost_sync_state(provider, connection_status, last_sync_at, last_error, updated_at)
       VALUES('stripe',$2,now(),$1,now())
       ON CONFLICT(provider) DO UPDATE
       SET connection_status=$2, last_sync_at=now(), last_error=COALESCE($1,private.provider_cost_sync_state.last_error), updated_at=now()`,
      [
        failed || incompleteRefundLookups
          ? `${failed} invoice customer error(s); ${incompleteRefundLookups} incomplete refund lookup(s)`
          : truncated
            ? "Invoice sync truncated before full coverage"
            : null,
        connectionStatus,
      ],
    );
    const status =
      failed === 0 && incompleteRefundLookups === 0
        ? "succeeded"
        : processed > 0
          ? "partial"
          : "failed";
    const details = {
      kind: "stripe_invoices",
      customersTotal,
      customersSynced,
      truncated,
      incompleteRefundLookups,
      completeCoverage,
      errors: errors.slice(0, 25),
    };
    await finishRun(runId, status, processed, failed, details, failed ? errors[0] : undefined);
    return { runId, processed, failed, status, errors: errors.slice(0, 25), details };
  } catch (e) {
    await finishRun(
      runId,
      "failed",
      processed,
      failed,
      { kind: "stripe_invoices", completeCoverage: false },
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
      const details = {
        subscriptions: subs.details,
        invoices: invoices.details,
        completeCoverage: Boolean(
          subs.details?.completeCoverage && invoices.details?.completeCoverage,
        ),
      };
      await finishRun(runId, status, processed, failed, details);
      return {
        runId,
        processed,
        failed,
        status,
        errors: [...subs.errors, ...invoices.errors].slice(0, 40),
        subscriptions: subs,
        invoices,
        details,
      };
    } catch (e) {
      await finishRun(
        runId,
        "failed",
        0,
        1,
        { completeCoverage: false },
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

/** Latest invoice sync coverage flag used for cash verification. */
export async function latestInvoiceSyncCoverage() {
  const { rows } = await getPool().query(
    `SELECT status, details, finished_at, started_at
     FROM private.financial_sync_runs
     WHERE kind IN ('stripe_invoices','full')
     ORDER BY started_at DESC
     LIMIT 1`,
  );
  const row = rows[0];
  if (!row) return { completeCoverage: false, lastAt: null as string | null, status: null as string | null };
  const details = (row.details || {}) as Record<string, unknown>;
  const nested = details.invoices as { completeCoverage?: boolean } | undefined;
  const completeCoverage = Boolean(
    row.status === "succeeded" &&
      (details.completeCoverage === true || nested?.completeCoverage === true),
  );
  return {
    completeCoverage,
    lastAt: (row.finished_at || row.started_at) as string | null,
    status: row.status as string,
  };
}
