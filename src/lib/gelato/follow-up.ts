import { after } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { getPool } from "../db";
import { refreshCatalog } from "./catalog";
import { processSupplierOrders, publicOrigin } from "./fulfillment";
import { deliverMarketplaceNotifications } from "./notifications";

/** Customer link for an order email; guests get a fresh expiring access link. */
export async function orderLink(orderId: string, guest: boolean) {
  const origin = publicOrigin() || (process.env.NEXT_PUBLIC_APP_URL || "https://gozenvio.com").replace(/\/$/, "");
  if (!guest) return `${origin}/marketplace/orders?order=${orderId}`;
  const token = randomBytes(32).toString("base64url");
  await getPool().query(
    "INSERT INTO private.marketplace_order_access(token_hash,order_id,purpose,expires_at) VALUES($1,$2,'guest_view',now()+interval '14 days')",
    [createHash("sha256").update(token).digest("hex"), orderId],
  );
  return `${origin}/marketplace/track#t=${token}`;
}

/** Scheduled marketplace work. Errors are contained so other jobs keep running. */
export async function processMarketplaceJobs() {
  const result: Record<string, unknown> = {};
  try {
    result.fulfillment = await processSupplierOrders(10);
  } catch {
    result.fulfillment = "error";
  }
  try {
    result.notifications = await deliverMarketplaceNotifications(orderLink, 20);
  } catch {
    result.notifications = "error";
  }
  try {
    // Imported products refresh daily; nothing new is ever imported here.
    const i = (await getPool().query("SELECT enabled,status,last_catalog_sync_at FROM private.supplier_integrations WHERE provider='gelato'")).rows[0];
    if (i?.enabled && i.status === "connected" && (!i.last_catalog_sync_at || Date.now() - new Date(i.last_catalog_sync_at).getTime() > 24 * 3600 * 1000))
      result.catalog = await refreshCatalog(null);
  } catch {
    result.catalog = "error";
  }
  return result;
}

/** Runs fulfillment and email after the response is sent (webhooks stay fast). */
export function runMarketplaceFollowUp() {
  try {
    after(async () => {
      try {
        await processSupplierOrders(5);
        await deliverMarketplaceNotifications(orderLink, 10);
      } catch {
        // The scheduled job runner retries.
      }
    });
  } catch {
    // Outside a request scope (tests/scripts): rely on the job runner.
  }
}
