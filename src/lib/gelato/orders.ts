import { createHash, randomBytes } from "node:crypto";
import { getPool } from "../db";
import { ApiError } from "../server";
import { marketOrderDetail } from "../marketplace";
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
  const extra = (await getPool().query("SELECT order_number,guest FROM private.marketplace_orders WHERE id=$1", [orderId])).rows[0];
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

// ---------- Guest access ----------
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
export async function orderForGuestToken(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError("This order link is invalid or has expired.", 404);
  const row = (await getPool().query("SELECT order_id FROM private.marketplace_order_access WHERE token_hash=$1 AND purpose='guest_view' AND expires_at>now()", [hash(token)])).rows[0];
  if (!row) throw new ApiError("This order link is invalid or has expired.", 404);
  return customerOrder(row.order_id);
}

/**
 * Emails a fresh expiring link when the email and order number match. The
 * response is identical either way, so it cannot be used to probe orders.
 */
export async function requestGuestLink(emailAddress: string, orderNumber: string, clientKey: string, send: (to: string, url: string) => Promise<void>) {
  const key = hash(`lookup:${clientKey}`), emailKey = hash(`lookup-email:${emailAddress}`);
  const recent = (
    await getPool().query("SELECT count(*) FILTER (WHERE key_hash=$1)::int a,count(*) FILTER (WHERE key_hash=$2)::int b FROM private.marketplace_lookup_attempts WHERE created_at>now()-interval '1 hour' AND key_hash IN ($1,$2)", [key, emailKey])
  ).rows[0];
  if (recent.a >= 10 || recent.b >= 5) throw new ApiError("Too many lookups. Please try again later.", 429);
  await getPool().query("INSERT INTO private.marketplace_lookup_attempts(key_hash) VALUES($1),($2)", [key, emailKey]);
  await getPool().query("DELETE FROM private.marketplace_lookup_attempts WHERE created_at<now()-interval '1 day'");
  const order = (
    await getPool().query("SELECT id,customer_email FROM private.marketplace_orders WHERE upper(order_number)=upper($1) AND lower(customer_email)=lower($2) AND guest AND payment_status<>'pending'", [orderNumber, emailAddress])
  ).rows[0];
  if (!order) return;
  const token = randomBytes(32).toString("base64url");
  await getPool().query("INSERT INTO private.marketplace_order_access(token_hash,order_id,purpose,expires_at) VALUES($1,$2,'guest_view',now()+interval '24 hours')", [hash(token), order.id]);
  const origin = publicOrigin() || (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  await send(order.customer_email, `${origin}/marketplace/track#t=${token}`);
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
