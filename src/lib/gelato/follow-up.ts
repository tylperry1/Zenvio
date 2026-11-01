import { after } from "next/server";
import { getPool } from "../db";
import { deliverMarketEmails } from "../market-mail";
import { refreshCatalog } from "./catalog";
import { processSupplierOrders } from "./fulfillment";
import { deliverAdminAlerts } from "./notifications";

/** Scheduled Gelato work. Customer emails are delivered by the job runner's market-mail step. */
export async function processMarketplaceJobs() {
  const result: Record<string, unknown> = {};
  try {
    result.fulfillment = await processSupplierOrders(10);
  } catch {
    result.fulfillment = "error";
  }
  try {
    result.alerts = await deliverAdminAlerts(20);
  } catch {
    result.alerts = "error";
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
        await deliverMarketEmails(10);
        await deliverAdminAlerts(10);
      } catch {
        // The scheduled job runner retries.
      }
    });
  } catch {
    // Outside a request scope (tests/scripts): rely on the job runner.
  }
}
