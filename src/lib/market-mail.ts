import type { PoolClient } from "pg";
import { getPool } from "./db";
import { integrationValue, unsealSecret } from "./platform-settings";
import { resendFailure } from "./resend-diagnostics";
import { transactionalEmail } from "./transactional-email";

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
      subject: `Your order is confirmed (#${ref})`,
      lead: `Thank you for your order. We’ve received your payment of ${usd(order.total_cents)}. We’ll email you when production starts and again when it ships.`,
    },
    in_production: { subject: `Your order is in production (#${ref})`, lead: "Your order is now being produced. We’ll send tracking details as soon as it ships." },
    shipped: {
      subject: `Your order has shipped (#${ref})`,
      lead: "Good news — your order is on its way.",
      extra: [order.carrier && `Carrier: ${order.carrier}`, order.tracking_number && `Tracking number: ${order.tracking_number}`, order.tracking_url && `Track your package: ${order.tracking_url}`].filter(Boolean) as string[],
    },
    delivered: { subject: `Your order was delivered (#${ref})`, lead: "Your order has been marked as delivered. If anything isn’t right, contact us from your order page and we’ll make it right." },
    refunded: { subject: `Your refund is on its way (#${ref})`, lead: `We’ve issued a refund of ${usd(order.refunded_cents || order.total_cents)}. It usually appears on your statement within 5–10 business days.` },
    cancelled: { subject: `Your order was cancelled (#${ref})`, lead: "Your order has been cancelled. If you were charged, we’ll confirm your refund in a separate email." },
    delayed: { subject: `An update on your order (#${ref})`, lead: "Your order needs a little more time before it can continue. Our team is on it and will contact you if we need anything from you." },
  };
  const c = copy[kind];
  const text = [`Hi ${first},`, "", c.lead, ...(c.extra?.length ? ["", ...c.extra] : []), "", `Order #${ref}:`, ...lines, `Total — ${usd(order.total_cents)}`, "", `View your order:`, orderUrl, "", "Zenvio Marketplace"].join("\n");
  const rows: [string, string][] = [...order.items.map((i): [string, string] => [`${i.quantity} × ${i.title}`, usd(i.price_cents * i.quantity)]), ["Total", usd(order.total_cents)]];
  const htmlText = [`Hi ${first},`, "", c.lead, ...(c.extra?.length ? ["", ...c.extra] : []), "", `Order #${ref}`].join("\n");
  const html = transactionalEmail(c.subject, htmlText, { action: { label: "View your order", url: orderUrl }, rows, preheader: c.lead });
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
