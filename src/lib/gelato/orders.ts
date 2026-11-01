import { getPool } from "../db";
import { ApiError } from "../server";
import { guestTokenHash, marketOrderDetail } from "../marketplace";
import { unsealSecret } from "../platform-settings";
import { publicOrigin } from "./fulfillment";
import { queueAdminAlert } from "./notifications";

// Customer-safe fulfillment details. Supplier costs, raw payloads and
// supplier identifiers never appear in these responses.

const labels: Record<string, string> = {
  pending: "Awaiting payment",
  awaiting_artwork: "Awaiting artwork approval",
  ready: "Ready for production",
  submitting: "Sending to production",
  uncertain: "Sending to production",
  submitted: "Submitted to production",
  accepted: "Accepted for production",
  in_production: "In production",
  shipped: "Shipped",
  delivered: "Delivered",
  failed: "Needs attention",
  needs_review: "Being reviewed by our team",
  cancelled: "Cancelled",
};

export async function customerFulfillment(orderId: string) {
  const so = (await getPool().query("SELECT id,status,submitted_at,updated_at FROM private.supplier_orders WHERE order_id=$1", [orderId])).rows[0];
  if (!so) return null;
  const shipments = (
    await getPool().query("SELECT tracking_code,tracking_url,carrier,status,shipped_at,delivered_at FROM private.supplier_shipments WHERE supplier_order_id=$1 ORDER BY shipped_at", [so.id])
  ).rows;
  return { status: so.status, label: labels[so.status] || "Processing", submittedAt: so.submitted_at, updatedAt: so.updated_at, shipments };
}

export async function customerOrder(orderId: string, userId?: string) {
  const order = await marketOrderDetail(orderId, userId);
  const designs = (
    await getPool().query(
      `SELECT i.id AS item_id,i.design_id,i.design_revision,i.supplier_variant_id,d.name,
              (SELECT json_agg(json_build_object('id',f.id,'area',f.area) ORDER BY f.area) FROM private.design_proofs f WHERE f.design_id=i.design_id AND f.design_revision=i.design_revision) AS proofs
         FROM private.marketplace_order_items i LEFT JOIN private.saved_designs d ON d.id=i.design_id WHERE i.order_id=$1 AND i.design_id IS NOT NULL`,
      [orderId],
    )
  ).rows;
  const extra = (await getPool().query("SELECT order_number,(user_id IS NULL) AS guest FROM private.marketplace_orders WHERE id=$1", [orderId])).rows[0];
  const fulfillment = await customerFulfillment(orderId);
  return {
    ...order,
    order_number: extra?.order_number || null,
    guest: extra?.guest || false,
    designs,
    fulfillment,
    cancellable: canRequestCancellation(order.status, order.payment_status, fulfillment?.status),
  };
}
export function canRequestCancellation(status: string, payment: string, supplier?: string) {
  return payment === "paid" && ["paid", "processing"].includes(status) && (!supplier || ["ready", "needs_review", "pending"].includes(supplier));
}

// ---------- Guest access (token model from migration 058) ----------
/** Resolves a guest's private order token (URL fragment) to their order id. */
export async function guestOrderId(token: unknown) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw new ApiError("Order not found.", 404);
  const row = (await getPool().query("SELECT id FROM private.marketplace_orders WHERE guest_token_hash=$1 AND user_id IS NULL", [guestTokenHash(token)])).rows[0];
  if (!row) throw new ApiError("Order not found.", 404);
  return row.id as string;
}

/**
 * Emails the guest's private order link when the email and order number match.
 * Callers return the same response either way, so it cannot probe for orders.
 */
export async function requestGuestLink(emailAddress: string, orderNumber: string, send: (to: string, url: string) => Promise<void>) {
  const order = (
    await getPool().query(
      "SELECT id,customer_email,guest_token_sealed FROM private.marketplace_orders WHERE upper(order_number)=upper($1) AND lower(customer_email)=lower($2) AND user_id IS NULL AND payment_status<>'pending' AND guest_token_sealed IS NOT NULL",
      [orderNumber, emailAddress],
    )
  ).rows[0];
  if (!order) return;
  const origin = publicOrigin() || (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  await send(order.customer_email, `${origin}/marketplace/order#${unsealSecret(order.guest_token_sealed)}`);
}

/** Customer cancellation or support request: recorded and routed to admins; never auto-refunds. */
export async function customerRequest(orderId: string, kind: "cancel" | "support" | "return", message: string, actor: string | null) {
  const order = await customerOrder(orderId);
  if (kind === "cancel" && !order.cancellable) throw new ApiError("This order is already in production. Contact support about returns.", 409);
  const recent = (await getPool().query("SELECT count(*)::int n FROM private.marketplace_order_activity WHERE order_id=$1 AND action LIKE 'customer_%' AND created_at>now()-interval '1 day'", [orderId])).rows[0].n;
  if (recent >= 5) throw new ApiError("We've received your requests and will be in touch.", 429);
  await getPool().query("INSERT INTO private.marketplace_order_activity(order_id,actor_id,action,note) VALUES($1,$2,$3,$4)", [orderId, actor, `customer_${kind}_request`, message.slice(0, 1000)]);
  if (kind === "cancel")
    // Hold production until an admin decides; nothing is submitted while held.
    await getPool().query("UPDATE private.supplier_orders SET status='needs_review',last_error='Customer requested cancellation.',updated_at=now() WHERE order_id=$1 AND status IN ('pending','ready')", [orderId]);
  await queueAdminAlert(`customer-${kind}:${orderId}:${Date.now()}`, `Customer ${kind} request – ${order.order_number || orderId.slice(0, 8)}`, message.slice(0, 1000) || "(no message)");
  return { ok: true };
}
