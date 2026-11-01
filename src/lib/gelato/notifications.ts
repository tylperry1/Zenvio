import type { PoolClient } from "pg";
import { getPool } from "../db";
import { integrationValue } from "../platform-settings";

// Marketplace order emails through the existing Resend credentials and sender.
// Each (order, kind, key) row is unique, so an email is queued at most once;
// the Resend Idempotency-Key is the row id, so retries never duplicate.

type DB = Pick<PoolClient, "query">;
export type NotificationKind =
  | "order_confirmation"
  | "artwork_approved"
  | "artwork_revision"
  | "submitted"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded"
  | "exception";

export async function queueOrderNotification(orderId: string, kind: NotificationKind, dedupeKey = "", db: DB = getPool()) {
  const order = (await db.query("SELECT customer_email FROM private.marketplace_orders WHERE id=$1", [orderId])).rows[0];
  if (!order?.customer_email) return;
  await db.query(
    "INSERT INTO private.marketplace_notifications(order_id,kind,dedupe_key,recipient) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
    [orderId, kind, dedupeKey.slice(0, 200), order.customer_email],
  );
}

/** Admin alerts go to MASTER_ADMIN_EMAIL; the subject/body are stored in the dedupe key payload. */
export async function queueAdminAlert(key: string, subject: string, body: string, db: DB = getPool()) {
  const to = (process.env.MASTER_ADMIN_EMAIL || "").trim();
  await db.query("INSERT INTO private.operation_log(action,details) VALUES('marketplace_admin_alert',$1)", [JSON.stringify({ key, subject, body: body.slice(0, 1000) })]);
  if (!to) return;
  await db.query(
    "INSERT INTO private.marketplace_notifications(order_id,kind,dedupe_key,recipient,error) VALUES(NULL,'admin_alert',$1,$2,NULL) ON CONFLICT DO NOTHING",
    [JSON.stringify({ key, subject: subject.slice(0, 150), body: body.slice(0, 1500) }).slice(0, 2000), to],
  );
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

type OrderView = {
  id: string;
  order_number: string | null;
  customer_name: string;
  total_cents: number;
  refunded_cents: number;
  guest: boolean;
  tracking_number: string;
  tracking_url: string;
  carrier: string;
  items: { title: string; quantity: number; price_cents: number }[];
};

const copy: Record<NotificationKind, (o: OrderView) => { subject: string; heading: string; body: string }> = {
  order_confirmation: (o) => ({ subject: `Order confirmed – ${ref(o)}`, heading: "Thank you for your order", body: "Your payment was received. We'll prepare your items for production and email you as they move along." }),
  artwork_approved: (o) => ({ subject: `Artwork approved – ${ref(o)}`, heading: "Your artwork is approved", body: "Your approved design has passed production checks and is queued for manufacturing." }),
  artwork_revision: (o) => ({ subject: `Action needed: artwork revision – ${ref(o)}`, heading: "Your artwork needs a change", body: "Our production checks found an issue with your artwork. Reply to this email or contact support and we'll help you fix it before anything is printed." }),
  submitted: (o) => ({ subject: `In production – ${ref(o)}`, heading: "Your order is headed to production", body: "Your order has been sent to our print partner. We'll email you tracking details as soon as it ships." }),
  shipped: (o) => ({ subject: `Shipped – ${ref(o)}`, heading: "Your order has shipped", body: o.tracking_number ? `Carrier: ${o.carrier || "See tracking link"}\nTracking number: ${o.tracking_number}` : "Your order is on its way." }),
  delivered: (o) => ({ subject: `Delivered – ${ref(o)}`, heading: "Your order was delivered", body: "The carrier reports your order as delivered. We hope you love it." }),
  cancelled: (o) => ({ subject: `Order cancelled – ${ref(o)}`, heading: "Your order was cancelled", body: "This order has been cancelled. If a payment was taken, any refund is shown in a separate email." }),
  refunded: (o) => ({ subject: `Refund issued – ${ref(o)}`, heading: "Your refund is on its way", body: `We've refunded ${usd(o.refunded_cents)}. Refunds usually appear on your statement within 5–10 business days.` }),
  exception: (o) => ({ subject: `Update on your order – ${ref(o)}`, heading: "We're looking into your order", body: "Something needs our attention before your order can continue. Our team is on it and will contact you if we need anything." }),
};
function ref(o: OrderView) {
  return o.order_number || `#${o.id.slice(0, 8).toUpperCase()}`;
}

export function renderOrderEmail(kind: NotificationKind, o: OrderView, link: string) {
  const c = copy[kind](o);
  const rows = o.items
    .map((i) => `<tr><td style="padding:8px 0;color:#151b38">${esc(i.title)} × ${i.quantity}</td><td style="padding:8px 0;text-align:right;color:#151b38">${usd(i.price_cents * i.quantity)}</td></tr>`)
    .join("");
  const tracking =
    kind === "shipped" && o.tracking_url
      ? `<p style="margin:20px 0"><a href="${esc(o.tracking_url)}" style="background:#365cff;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600">Track package</a></p>`
      : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:14px;overflow:hidden">
<tr><td style="background:#151b38;padding:22px 28px;color:#fff;font-size:18px;font-weight:700;letter-spacing:.4px">Zenvio <span style="color:#8ea2ff;font-weight:500">Marketplace</span></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 8px;font-size:22px;color:#151b38">${esc(c.heading)}</h1>
<p style="margin:0 0 4px;color:#5b6280;font-size:13px">Order ${esc(ref(o))}</p>
<p style="color:#2b3150;font-size:15px;line-height:1.55;white-space:pre-line">${esc(c.body)}</p>
${tracking}
${rows ? `<table role="presentation" width="100%" style="border-top:1px solid #e6e9f2;margin-top:16px;font-size:14px">${rows}<tr><td style="padding:10px 0;border-top:1px solid #e6e9f2;font-weight:700">Total</td><td style="padding:10px 0;border-top:1px solid #e6e9f2;text-align:right;font-weight:700">${usd(o.total_cents)}</td></tr></table>` : ""}
<p style="margin:24px 0 0"><a href="${esc(link)}" style="color:#365cff;font-weight:600">View your order</a></p>
</td></tr>
<tr><td style="padding:18px 28px;background:#f8f9fd;color:#7a8099;font-size:12px">Questions? Reply to this email. Zenvio · gozenvio.com</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${c.heading}\nOrder ${ref(o)}\n\n${c.body}\n\n${o.items.map((i) => `${i.title} x ${i.quantity}: ${usd(i.price_cents * i.quantity)}`).join("\n")}\nTotal: ${usd(o.total_cents)}\n${kind === "shipped" && o.tracking_url ? `Track: ${o.tracking_url}\n` : ""}\nView your order: ${link}`;
  return { subject: c.subject, html, text };
}

type Sender = (input: { to: string; subject: string; html?: string; text: string; idempotencyKey: string }) => Promise<void>;
let sender: Sender | null = null;
/** Test hook: substitute the email transport. */
export function setMarketplaceMailer(next: Sender | null) {
  sender = next;
}
async function resend(input: Parameters<Sender>[0]) {
  if (sender) return sender(input);
  const [key, from] = await Promise.all([integrationValue("RESEND_API_KEY"), integrationValue("AUTH_EMAIL_FROM")]);
  if (!key.trim() || !from.trim()) throw new Error("not_configured");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key.trim()}`, "Content-Type": "application/json", "Idempotency-Key": `market-${input.idempotencyKey}` },
    body: JSON.stringify({ from: from.trim(), to: input.to, subject: input.subject, html: input.html, text: input.text }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`resend_${r.status}`);
}

/** Link builder is injected so guest orders receive a fresh, expiring access link. */
export async function deliverMarketplaceNotifications(link: (orderId: string, guest: boolean) => Promise<string>, limit = 20) {
  let sent = 0, failed = 0;
  if (!sender) {
    const [key, from] = await Promise.all([integrationValue("RESEND_API_KEY"), integrationValue("AUTH_EMAIL_FROM")]);
    // Leave the queue untouched until email is configured, so nothing is lost.
    if (!key.trim() || !from.trim()) return { sent, failed, configured: false };
  }
  for (let n = 0; n < limit; n++) {
    const db = await getPool().connect();
    let row: any;
    try {
      await db.query("BEGIN");
      row = (
        await db.query(
          "SELECT * FROM private.marketplace_notifications WHERE status IN ('pending','failed') AND attempts<5 AND (status='pending' OR created_at<now()-interval '2 minutes'*attempts) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
        )
      ).rows[0];
      if (!row) {
        await db.query("COMMIT");
        break;
      }
      await db.query("UPDATE private.marketplace_notifications SET attempts=attempts+1 WHERE id=$1", [row.id]);
      let message: { subject: string; html?: string; text: string };
      if (row.kind === "admin_alert") {
        const alert = JSON.parse(row.dedupe_key);
        message = { subject: `[Zenvio admin] ${alert.subject}`, text: alert.body };
      } else {
        const order = (await db.query("SELECT id,order_number,customer_name,total_cents,refunded_cents,guest,tracking_number,tracking_url,carrier FROM private.marketplace_orders WHERE id=$1", [row.order_id])).rows[0];
        const items = (await db.query("SELECT title,quantity,price_cents FROM private.marketplace_order_items WHERE order_id=$1 ORDER BY title", [row.order_id])).rows;
        message = renderOrderEmail(row.kind, { ...order, items }, await link(order.id, order.guest));
      }
      try {
        await resend({ to: row.recipient, ...message, idempotencyKey: row.id });
        await db.query("UPDATE private.marketplace_notifications SET status='sent',sent_at=now(),error=NULL WHERE id=$1", [row.id]);
        sent++;
      } catch (e) {
        const reason = e instanceof Error ? e.message.slice(0, 300) : "send_failed";
        await db.query("UPDATE private.marketplace_notifications SET status=$2,error=$3 WHERE id=$1", [row.id, reason === "not_configured" ? "skipped" : "failed", reason]);
        failed++;
      }
      await db.query("COMMIT");
    } catch {
      await db.query("ROLLBACK").catch(() => {});
      failed++;
      break;
    } finally {
      db.release();
    }
  }
  return { sent, failed, configured: true };
}
