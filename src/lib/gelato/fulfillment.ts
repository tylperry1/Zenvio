import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "../db";
import { ApiError, uuid } from "../server";
import { printFileUrl } from "../studio/assets";
import { gelatoRequest, recordSuccess } from "./client";
import {
  GELATO_ENDPOINTS,
  GelatoError,
  buildOrderPayload,
  findOrderByReference,
  mapFulfillmentStatus,
  nextStatus,
  parseShipments,
  type OrderAddress,
  type PayloadItem,
} from "./core";
import { queueAdminAlert, queueOrderNotification } from "./notifications";

// Supplier order lifecycle:
//   pending (awaiting payment) → ready (paid) → submitting → submitted → accepted
//   → in_production → shipped → delivered
// Exceptions: uncertain (outcome unknown: always looked up before any retry),
// needs_review (manual queue), failed, cancelled.
// An order is only ever submitted after Stripe confirmed payment.

type DB = Pick<PoolClient, "query">;
const MAX_ATTEMPTS = 6;

export function publicOrigin() {
  const origin = (process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "").replace(/\/$/, "");
  return /^https:\/\//.test(origin) ? origin : null;
}

async function event(db: DB, id: string, action: string, detail = "", actor: string | null = null) {
  await db.query("INSERT INTO private.supplier_order_events(supplier_order_id,action,detail,actor_id) VALUES($1,$2,$3,$4)", [id, action.slice(0, 80), detail.slice(0, 1000), actor]);
}
function backoff(attempts: number) {
  return Math.min(6 * 3600, 60 * 2 ** attempts);
}
async function integrationGate(db: DB = getPool()) {
  const i = (await db.query("SELECT enabled,fulfillment_enabled,fulfillment_paused FROM private.supplier_integrations WHERE provider='gelato'")).rows[0];
  if (!i?.enabled) return "Gelato integration is disabled.";
  if (!i.fulfillment_enabled) return "Live Gelato fulfillment is not enabled.";
  if (i.fulfillment_paused) return "Gelato fulfillment is paused by an administrator.";
  return null;
}

/** Converts the stored order address (Stripe shipping_details shape) into a supplier address. */
export function orderAddress(order: { shipping_address: any; customer_email: string; business_name: string }): OrderAddress | null {
  const s = order.shipping_address, a = s?.address;
  if (!s?.name || !a?.line1 || !a?.city || !a?.postal_code || !a?.country) return null;
  return {
    name: String(s.name).slice(0, 100),
    company: order.business_name || undefined,
    line1: String(a.line1).slice(0, 100),
    line2: a.line2 ? String(a.line2).slice(0, 100) : undefined,
    city: String(a.city).slice(0, 60),
    state: String(a.state || "").slice(0, 60),
    postalCode: String(a.postal_code).slice(0, 20),
    country: String(a.country).slice(0, 2),
    email: order.customer_email,
    phone: s.phone ? String(s.phone).slice(0, 30) : undefined,
  };
}

/** Builds the Gelato items for an order's supplier lines from approved print files. */
export async function payloadItems(db: DB, orderId: string, origin: string): Promise<PayloadItem[]> {
  const items = (
    await db.query(
      "SELECT id,quantity,supplier_variant_uid,print_files FROM private.marketplace_order_items WHERE order_id=$1 AND supplier_variant_uid IS NOT NULL ORDER BY id",
      [orderId],
    )
  ).rows;
  return items.map((i) => {
    const files = (Array.isArray(i.print_files) ? i.print_files : []) as { proofId: string; fileType: string }[];
    return {
      itemReferenceId: i.id,
      productUid: i.supplier_variant_uid,
      quantity: i.quantity,
      files: files.map((f) => ({ type: f.fileType, url: printFileUrl(origin, f.proofId) })),
    };
  });
}

async function claim(id: string, statuses: string[]) {
  return (
    await getPool().query(
      `UPDATE private.supplier_orders SET locked_until=now()+interval '3 minutes' WHERE id=$1 AND status=ANY($2) AND (locked_until IS NULL OR locked_until<now()) RETURNING *`,
      [id, statuses],
    )
  ).rows[0];
}
async function release(id: string, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  await getPool().query(
    `UPDATE private.supplier_orders SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(",")}${keys.length ? "," : ""}locked_until=NULL,updated_at=now() WHERE id=$1`,
    [id, ...keys.map((k) => fields[k])],
  );
}

/**
 * Submits one paid supplier order. Safe to call repeatedly and concurrently:
 * a row lock prevents parallel submission, and any order whose earlier attempt
 * may have reached Gelato is looked up by reference before resubmitting.
 */
export async function submitSupplierOrder(id: string) {
  const gate = await integrationGate();
  if (gate) return { status: "held", reason: gate };
  const so = await claim(id, ["ready", "uncertain"]);
  if (!so) return { status: "skipped" };
  const db = getPool();
  try {
    const order = (await db.query("SELECT * FROM private.marketplace_orders WHERE id=$1", [so.order_id])).rows[0];
    if (!order || order.payment_status !== "paid" || order.status === "cancelled") {
      await release(so.id, { status: "needs_review", last_error: "Order is not in a paid state; submission blocked." });
      await event(db, so.id, "submission_blocked", "Order is not paid or was cancelled/refunded.");
      return { status: "needs_review" };
    }
    // 1. Uncertain or retried orders: look for an existing supplier order first.
    if (so.status === "uncertain" || so.attempts > 0) {
      let found;
      try {
        found = findOrderByReference(
          await gelatoRequest({ host: "order", method: "POST", path: GELATO_ENDPOINTS.searchOrders(), body: { orderReferenceId: so.reference_id, limit: 10, offset: 0 }, operation: "order_lookup", orderId: so.order_id }),
          so.reference_id,
        );
      } catch (e) {
        const attempts = so.attempts + 1;
        await release(so.id, attempts >= MAX_ATTEMPTS ? { status: "needs_review", attempts, last_error: "Could not confirm supplier order state." } : { status: "uncertain", attempts, next_attempt_at: new Date(Date.now() + backoff(attempts) * 1000), last_error: e instanceof GelatoError ? e.message : "Lookup failed." });
        await event(db, so.id, "lookup_failed", e instanceof GelatoError ? e.message : "Lookup failed.");
        return { status: "uncertain" };
      }
      if (found) {
        await release(so.id, { status: nextStatus("submitted", mapFulfillmentStatus(found.fulfillmentStatus)), supplier_order_id: found.id, supplier_status: found.fulfillmentStatus || null, submitted_at: new Date(), last_error: null });
        await event(db, so.id, "reconciled", `Found existing Gelato order ${found.id}; not resubmitted.`);
        await queueOrderNotification(so.order_id, "submitted");
        return { status: "submitted", supplierOrderId: found.id };
      }
    }
    // 2. Build and validate the payload.
    const origin = publicOrigin();
    const address = orderAddress(order);
    const items = origin ? await payloadItems(db, so.order_id, origin) : [];
    let payload;
    try {
      if (!origin) throw new Error("A public HTTPS app URL (NEXT_PUBLIC_APP_URL) is required for supplier file access.");
      if (!address) throw new Error("The order has no complete shipping address.");
      payload = buildOrderPayload({ referenceId: so.reference_id, customerReferenceId: order.user_id || `guest-${order.id}`, address, items, shipmentMethodUid: so.shipment_method_uid });
    } catch (e) {
      await release(so.id, { status: "needs_review", last_error: (e as Error).message.slice(0, 500) });
      await event(db, so.id, "payload_invalid", (e as Error).message);
      await queueAdminAlert(`payload:${so.id}`, "Gelato order needs review", `Order ${order.order_number || order.id}: ${(e as Error).message}`);
      return { status: "needs_review" };
    }
    // 3. Persist the attempt before calling out, so a crash is treated as uncertain.
    const attempts = so.attempts + 1;
    await db.query("UPDATE private.supplier_orders SET status='submitting',attempts=$2,payload_sha256=$3,updated_at=now() WHERE id=$1", [
      so.id,
      attempts,
      createHash("sha256").update(JSON.stringify({ ...payload, items: payload.items.map((i) => ({ ...i, files: i.files.map((f) => f.type) })) })).digest("hex"),
    ]);
    try {
      const created = (await gelatoRequest({ host: "order", method: "POST", path: GELATO_ENDPOINTS.orders(), body: payload, operation: "order_create", orderId: so.order_id, timeoutMs: 30000 })) as any;
      if (!created || typeof created.id !== "string") throw new GelatoError("invalid_response", "Gelato accepted the request but returned no order id.");
      await recordSuccess();
      await release(so.id, {
        status: nextStatus("submitted", mapFulfillmentStatus(created.fulfillmentStatus)),
        supplier_order_id: created.id,
        supplier_status: typeof created.fulfillmentStatus === "string" ? created.fulfillmentStatus : null,
        submitted_at: new Date(),
        last_error: null,
        next_attempt_at: null,
      });
      await db.query("UPDATE private.supplier_integrations SET capabilities=capabilities||'{\"orderSubmission\":true}'::jsonb WHERE provider='gelato'");
      await db.query("UPDATE private.marketplace_orders SET status=CASE WHEN status='paid' THEN 'processing' ELSE status END,updated_at=now() WHERE id=$1", [so.order_id]);
      await db.query("INSERT INTO private.marketplace_order_activity(order_id,action,note) VALUES($1,'supplier_submitted',$2)", [so.order_id, `Gelato order ${created.id}`]);
      await event(db, so.id, "submitted", `Gelato order ${created.id}`);
      await queueOrderNotification(so.order_id, "submitted");
      return { status: "submitted", supplierOrderId: created.id };
    } catch (e) {
      const err = e instanceof GelatoError ? e : new GelatoError("unknown", "Unexpected submission failure.");
      if (err.category === "rejected" || err.category === "invalid_credentials") {
        // Definitive answers: Gelato did not create the order.
        await release(so.id, { status: "needs_review", last_error: err.message });
        await event(db, so.id, "rejected", err.message);
        await queueAdminAlert(`rejected:${so.id}:${attempts}`, "Gelato rejected an order", `Order ${order.order_number || order.id}: ${err.message}`);
        if (err.category === "rejected") await queueOrderNotification(so.order_id, "exception");
        return { status: "needs_review" };
      }
      // Timeout, network, 5xx, 429 or unreadable reply: outcome unknown; never resubmit blindly.
      const exhausted = attempts >= MAX_ATTEMPTS;
      await release(so.id, exhausted ? { status: "needs_review", last_error: err.message } : { status: "uncertain", last_error: err.message, next_attempt_at: new Date(Date.now() + (err.retryAfterSeconds ?? backoff(attempts)) * 1000) });
      await event(db, so.id, exhausted ? "attempts_exhausted" : "uncertain", err.message);
      if (exhausted) await queueAdminAlert(`exhausted:${so.id}`, "Gelato order needs review", `Order ${order.order_number || order.id} could not be confirmed after ${attempts} attempts.`);
      return { status: exhausted ? "needs_review" : "uncertain" };
    }
  } catch (e) {
    await release(so.id, {}).catch(() => {});
    throw e;
  }
}

/** Pulls the authoritative order state from Gelato and applies status and tracking. */
export async function syncSupplierOrder(id: string) {
  const so = (await getPool().query("SELECT * FROM private.supplier_orders WHERE id=$1", [id])).rows[0];
  if (!so?.supplier_order_id) return { status: so?.status || "unknown" };
  const remote = (await gelatoRequest({ host: "order", path: GELATO_ENDPOINTS.order(so.supplier_order_id), operation: "order_status", orderId: so.order_id })) as any;
  if (!remote || remote.id !== so.supplier_order_id) throw new GelatoError("invalid_response", "Gelato returned a different order.");
  const raw = typeof remote.fulfillmentStatus === "string" ? remote.fulfillmentStatus.slice(0, 60) : null;
  const status = nextStatus(so.status, mapFulfillmentStatus(raw));
  const shipments = parseShipments(remote);
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    const locked = (await db.query("SELECT status FROM private.supplier_orders WHERE id=$1 FOR UPDATE", [id])).rows[0];
    const previous = locked.status;
    const finalStatus = nextStatus(previous, mapFulfillmentStatus(raw));
    for (const s of shipments)
      await db.query(
        "INSERT INTO private.supplier_shipments(supplier_order_id,tracking_code,tracking_url,carrier,status,shipped_at) VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(supplier_order_id,tracking_code) DO UPDATE SET tracking_url=COALESCE(NULLIF($3,''),private.supplier_shipments.tracking_url),carrier=COALESCE(NULLIF($4,''),private.supplier_shipments.carrier),status=$5,delivered_at=CASE WHEN $5='delivered' THEN COALESCE(private.supplier_shipments.delivered_at,now()) ELSE private.supplier_shipments.delivered_at END,updated_at=now()",
        [id, s.trackingCode, s.trackingUrl, s.carrier, finalStatus === "delivered" ? "delivered" : "shipped"],
      );
    await db.query("UPDATE private.supplier_orders SET status=$2,supplier_status=$3,last_synced_at=now(),updated_at=now() WHERE id=$1", [id, finalStatus, raw]);
    if (finalStatus !== previous) {
      await event(db, id, "status_" + finalStatus, raw || "");
      const first = shipments[0];
      if (finalStatus === "shipped" || finalStatus === "delivered") {
        await db.query(
          "UPDATE private.marketplace_orders SET status=$2,tracking_number=COALESCE(NULLIF($3,''),tracking_number),tracking_url=COALESCE(NULLIF($4,''),tracking_url),carrier=COALESCE(NULLIF($5,''),carrier),updated_at=now() WHERE id=$1 AND status IN ('paid','processing','shipped')",
          [so.order_id, finalStatus, first?.trackingCode || "", first?.trackingUrl || "", first?.carrier || ""],
        );
        await db.query("INSERT INTO private.marketplace_order_activity(order_id,action) VALUES($1,$2)", [so.order_id, "order_" + finalStatus]);
        await queueOrderNotification(so.order_id, finalStatus === "shipped" ? "shipped" : "delivered", "", db);
      } else if (finalStatus === "in_production" || finalStatus === "accepted") {
        await db.query("UPDATE private.marketplace_orders SET status='processing',updated_at=now() WHERE id=$1 AND status='paid'", [so.order_id]);
      } else if (finalStatus === "cancelled" || finalStatus === "failed" || finalStatus === "needs_review") {
        await db.query("INSERT INTO private.marketplace_order_activity(order_id,action,note) VALUES($1,'supplier_exception',$2)", [so.order_id, raw || finalStatus]);
        await queueAdminAlert(`status:${id}:${finalStatus}`, `Gelato order ${finalStatus.replace("_", " ")}`, `Supplier order ${so.supplier_order_id} reported "${raw}". Review it in Commerce → Gelato.`, db);
        if (finalStatus !== "cancelled") await queueOrderNotification(so.order_id, "exception", finalStatus, db);
      }
    }
    await db.query("COMMIT");
    return { status: finalStatus, previous, shipments: shipments.length, computed: status };
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}

/** Background pass: submit due orders, then refresh in-flight ones (webhook fallback). */
export async function processSupplierOrders(limit = 10) {
  // A submission interrupted mid-call (crash/timeout) has an unknown outcome.
  await getPool().query("UPDATE private.supplier_orders SET status='uncertain',next_attempt_at=now(),updated_at=now() WHERE status='submitting' AND (locked_until IS NULL OR locked_until<now())");
  const due = (
    await getPool().query(
      "SELECT id FROM private.supplier_orders WHERE provider='gelato' AND status IN ('ready','uncertain') AND (next_attempt_at IS NULL OR next_attempt_at<=now()) ORDER BY created_at LIMIT $1",
      [limit],
    )
  ).rows;
  const results: Record<string, number> = {};
  for (const { id } of due) {
    try {
      const r = await submitSupplierOrder(id);
      results[r.status] = (results[r.status] || 0) + 1;
    } catch {
      results.error = (results.error || 0) + 1;
    }
  }
  const active = (
    await getPool().query(
      "SELECT id FROM private.supplier_orders WHERE provider='gelato' AND supplier_order_id IS NOT NULL AND status IN ('submitted','accepted','in_production','shipped') AND (last_synced_at IS NULL OR last_synced_at<now()-interval '2 hours') ORDER BY last_synced_at NULLS FIRST LIMIT $1",
      [limit],
    )
  ).rows;
  for (const { id } of active) {
    try {
      await syncSupplierOrder(id);
      results.synced = (results.synced || 0) + 1;
    } catch {
      results.sync_error = (results.sync_error || 0) + 1;
    }
  }
  return results;
}

/** Stripe refund received: stop unsubmitted orders; flag submitted ones for supplier cancellation review. */
export async function onOrderRefunded(orderId: string, fullyRefunded: boolean, db: DB = getPool()) {
  const so = (await db.query("SELECT id,status FROM private.supplier_orders WHERE order_id=$1", [orderId])).rows[0];
  if (!so) return;
  if (["pending", "awaiting_artwork", "ready"].includes(so.status)) {
    if (fullyRefunded) {
      await db.query("UPDATE private.supplier_orders SET status='cancelled',last_error='Refunded before submission.',updated_at=now() WHERE id=$1", [so.id]);
      await event(db, so.id, "cancelled_refund", "Refunded before supplier submission.");
    } else {
      await db.query("UPDATE private.supplier_orders SET status='needs_review',last_error='Partially refunded before submission; confirm what to produce.',updated_at=now() WHERE id=$1", [so.id]);
      await event(db, so.id, "held_partial_refund");
    }
  } else if (["submitting", "uncertain", "submitted", "accepted", "in_production"].includes(so.status)) {
    await db.query("UPDATE private.supplier_orders SET last_error='Refund issued after submission. Cancel at Gelato if production has not started.',updated_at=now() WHERE id=$1", [so.id]);
    await event(db, so.id, "refund_after_submission");
    await queueAdminAlert(`refund:${so.id}`, "Refund on a submitted Gelato order", "A refund was issued for an order already sent to Gelato. Review whether to cancel it with the supplier.", db);
  }
}

// ---------- Admin recovery actions ----------
export async function retrySupplierOrder(id: string, actor: string) {
  const db = getPool();
  const so = (await db.query("SELECT id,status,attempts,supplier_order_id FROM private.supplier_orders WHERE id=$1", [uuid(id)])).rows[0];
  if (!so) throw new ApiError("Supplier order not found.", 404);
  if (so.supplier_order_id) throw new ApiError("This order already exists at Gelato. Use refresh instead.", 409);
  if (!["needs_review", "failed", "uncertain"].includes(so.status)) throw new ApiError("Only orders needing review can be retried.", 409);
  // Any earlier attempt forces a reference lookup before resubmission.
  await db.query("UPDATE private.supplier_orders SET status=$2,next_attempt_at=now(),attempts=LEAST(attempts,$3),updated_at=now() WHERE id=$1", [so.id, so.attempts > 0 ? "uncertain" : "ready", MAX_ATTEMPTS - 2]);
  await event(db, so.id, "retry_requested", "", actor);
  return submitSupplierOrder(so.id);
}
export async function cancelAtSupplier(id: string, actor: string) {
  const db = getPool();
  const so = (await db.query("SELECT * FROM private.supplier_orders WHERE id=$1", [uuid(id)])).rows[0];
  if (!so) throw new ApiError("Supplier order not found.", 404);
  if (!so.supplier_order_id) {
    if (!["pending", "ready", "needs_review", "awaiting_artwork"].includes(so.status)) throw new ApiError("Submission state is uncertain; refresh before cancelling.", 409);
    await db.query("UPDATE private.supplier_orders SET status='cancelled',updated_at=now() WHERE id=$1", [so.id]);
    await event(db, so.id, "cancelled_before_submission", "", actor);
    return { status: "cancelled" };
  }
  await gelatoRequest({ host: "order", method: "POST", path: GELATO_ENDPOINTS.cancelOrder(so.supplier_order_id), body: {}, operation: "order_cancel", orderId: so.order_id });
  await event(db, so.id, "cancel_requested", `Gelato order ${so.supplier_order_id}`, actor);
  return syncSupplierOrder(so.id);
}
