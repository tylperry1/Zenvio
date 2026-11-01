import type { PoolClient } from "pg";
import { getPool } from "./db";
import { integrationValue, unsealSecret } from "./platform-settings";
import { resendFailure } from "./resend-diagnostics";

type DB = Pick<PoolClient, "query">;
export type MarketEmailKind = "confirmation" | "in_production" | "shipped" | "delivered" | "refunded" | "cancelled" | "delayed";

/**
 * Queues an order email inside the caller's transaction. The (order, kind)
 * unique key means each kind is sent at most once, however often it is queued.
 */
export async function queueMarketEmail(db: DB, orderId: string, kind: MarketEmailKind) {
  await db.query(
    `INSERT INTO private.marketplace_order_emails(order_id,kind,recipient)
     SELECT id,$2,customer_email FROM private.marketplace_orders WHERE id=$1
     ON CONFLICT (order_id,kind) DO NOTHING`,
    [orderId, kind],
  );
}

const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

type Order = {
  id: string;
  user_id: string | null;
  customer_name: string;
  total_cents: number;
  refunded_cents: number;
  tracking_number: string;
  tracking_url: string;
  carrier: string;
  guest_token_sealed: string | null;
  items: { title: string; quantity: number; price_cents: number }[];
};

/** Subject, plain text and HTML for one order email. Pure: easy to test. */
export function composeMarketEmail(kind: MarketEmailKind, order: Order, orderUrl: string) {
  const ref = order.id.slice(0, 8).toUpperCase();
  const first = order.customer_name.split(/\s+/)[0] || "there";
  const lines = order.items.map((i) => `${i.quantity} × ${i.title} — ${usd(i.price_cents * i.quantity)}`);
  const copy: Record<MarketEmailKind, { subject: string; lead: string; extra?: string[] }> = {
    confirmation: {
      subject: `Order ${ref} confirmed`,
      lead: `Thanks for your order. Your payment of ${usd(order.total_cents)} was received. We'll email you when production starts and again when it ships.`,
    },
    in_production: { subject: `Order ${ref} is in production`, lead: "Good news: your order is now being produced. We'll send tracking details as soon as it ships." },
    shipped: {
      subject: `Order ${ref} has shipped`,
      lead: "Your order is on its way.",
      extra: [order.carrier && `Carrier: ${order.carrier}`, order.tracking_number && `Tracking number: ${order.tracking_number}`, order.tracking_url && `Track it: ${order.tracking_url}`].filter(Boolean) as string[],
    },
    delivered: { subject: `Order ${ref} was delivered`, lead: "Your order has been marked as delivered. If anything isn't right, reply to this email and we'll help." },
    refunded: { subject: `Refund for order ${ref}`, lead: `A refund of ${usd(order.refunded_cents || order.total_cents)} has been issued. It usually appears on your statement within 5–10 business days.` },
    cancelled: { subject: `Order ${ref} was cancelled`, lead: "Your order was cancelled. If you were charged, any refund is confirmed separately." },
    delayed: { subject: `Update on order ${ref}`, lead: "Something needs our attention before your order can continue. Our team is on it and will contact you if we need anything from you." },
  };
  const c = copy[kind];
  const text = [`Hi ${first},`, "", c.lead, ...(c.extra?.length ? ["", ...c.extra] : []), "", "Your order:", ...lines, "", `View your order: ${orderUrl}`, "", "— Zenvio Marketplace"].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f6f8fc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#151b38">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e1e6f0">
<tr><td style="background:#151b38;padding:18px 24px;color:#ffffff;font-weight:700;font-size:18px">zenvio <span style="font-weight:500;color:#a8b8ff;font-size:13px">Marketplace</span></td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 6px;font-size:13px;color:#687390">Order ${escapeHtml(ref)}</p>
<h1 style="margin:0 0 14px;font-size:22px">${escapeHtml(c.subject.replace(/^Order \w+ /, "Your order ").replace(/^Refund for order \w+/, "Your refund"))}</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#4a5571">Hi ${escapeHtml(first)}, ${escapeHtml(c.lead)}</p>
${(c.extra || []).map((e) => `<p style="margin:0 0 6px;font-size:14px">${escapeHtml(e)}</p>`).join("")}
<table role="presentation" width="100%" style="margin:16px 0;border-top:1px solid #eef1f7">${order.items
    .map((i) => `<tr><td style="padding:8px 0;font-size:14px">${i.quantity} × ${escapeHtml(i.title)}</td><td align="right" style="padding:8px 0;font-size:14px">${usd(i.price_cents * i.quantity)}</td></tr>`)
    .join("")}</table>
<a href="${escapeHtml(orderUrl)}" style="display:inline-block;background:#365cff;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:10px">View your order</a>
</td></tr></table>
<p style="font-size:12px;color:#687390;margin:14px 0 0">Zenvio Marketplace · Payments processed by Stripe</p>
</td></tr></table></body></html>`;
  return { subject: c.subject, text, html };
}

function orderUrl(order: Order, origin: string) {
  if (order.user_id) return `${origin}/marketplace/orders?order=${order.id}`;
  try {
    return order.guest_token_sealed ? `${origin}/marketplace/order#${unsealSecret(order.guest_token_sealed)}` : `${origin}/marketplace`;
  } catch {
    return `${origin}/marketplace`;
  }
}

/**
 * Sends queued order emails. Each send uses a Resend idempotency key per order
 * and kind, so a retry after an uncertain failure can't deliver twice.
 */
export async function deliverMarketEmails(limit = 20) {
  const [key, from] = await Promise.all([integrationValue("RESEND_API_KEY"), integrationValue("AUTH_EMAIL_FROM")]);
  if (!key.trim() || !from.trim()) return { sent: 0, skipped: "email-not-configured" as const };
  const origin = process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "https://gozenvio.com";
  const db = getPool();
  const { rows: pending } = await db.query(
    `SELECT e.id,e.order_id,e.kind,e.recipient FROM private.marketplace_order_emails e
      WHERE e.sent_at IS NULL AND e.attempts<5 ORDER BY e.created_at LIMIT $1`,
    [limit],
  );
  let sent = 0;
  for (const job of pending) {
    // Claim the row so concurrent runners don't both send it.
    const claimed = await db.query(
      "UPDATE private.marketplace_order_emails SET attempts=attempts+1 WHERE id=$1 AND sent_at IS NULL AND attempts<5 RETURNING attempts",
      [job.id],
    );
    if (!claimed.rowCount) continue;
    try {
      const order = (await db.query("SELECT id,user_id,customer_name,total_cents,refunded_cents,tracking_number,tracking_url,carrier,guest_token_sealed FROM private.marketplace_orders WHERE id=$1", [job.order_id])).rows[0];
      if (!order) continue;
      order.items = (await db.query("SELECT title,quantity,price_cents FROM private.marketplace_order_items WHERE order_id=$1 ORDER BY title", [job.order_id])).rows;
      const mail = composeMarketEmail(job.kind, order, orderUrl(order, origin));
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key.trim()}`, "Content-Type": "application/json", "Idempotency-Key": `market-${job.order_id}-${job.kind}` },
        body: JSON.stringify({ from: from.trim(), to: job.recipient, subject: mail.subject, text: mail.text, html: mail.html }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw resendFailure(response.status, await response.json().catch(() => ({})));
      await db.query("UPDATE private.marketplace_order_emails SET sent_at=now(),last_error=NULL WHERE id=$1", [job.id]);
      await db.query("INSERT INTO private.marketplace_order_activity(order_id,action,note) VALUES($1,'email_sent',$2)", [job.order_id, job.kind]);
      sent++;
    } catch (e) {
      await db.query("UPDATE private.marketplace_order_emails SET last_error=$2 WHERE id=$1", [job.id, (e instanceof Error ? e.message : "Send failed").slice(0, 300)]);
    }
  }
  return { sent };
}
