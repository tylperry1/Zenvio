import { NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { getPool } from "@/lib/db";
import { parseWebhook } from "@/lib/gelato/core";
import { syncSupplierOrder } from "@/lib/gelato/fulfillment";
import { runMarketplaceFollowUp } from "@/lib/gelato/follow-up";
export const dynamic = "force-dynamic";

// Gelato order event webhook. The URL carries a secret token (stored only as a
// hash); the body is used solely to locate the order, and the authoritative
// status is then fetched from Gelato's API. Events are deduplicated by id.
export async function POST(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token") || "";
    const row = (await getPool().query("SELECT webhook_token_hash,enabled FROM private.supplier_integrations WHERE provider='gelato'")).rows[0];
    if (!row?.webhook_token_hash || !/^[A-Za-z0-9_-]{43}$/.test(token)) return new Response(null, { status: 401 });
    const given = Buffer.from(createHash("sha256").update(token).digest("hex"));
    const expected = Buffer.from(row.webhook_token_hash);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return new Response(null, { status: 401 });
    if (Number(request.headers.get("content-length")) > 200000) return new Response(null, { status: 413 });
    const raw = await request.text();
    if (raw.length > 200000) return new Response(null, { status: 413 });
    let parsed;
    try {
      parsed = parseWebhook(JSON.parse(raw));
    } catch {
      parsed = null;
    }
    if (!parsed) return Response.json({ ignored: true });
    await getPool().query("UPDATE private.supplier_integrations SET webhook_last_received_at=now(),capabilities=capabilities||'{\"webhooks\":true}'::jsonb WHERE provider='gelato'");
    const eventId = parsed.eventId ? `gelato:${parsed.eventId}` : `gelato:${createHash("sha256").update(raw).digest("hex")}`;
    const fresh = await getPool().query("INSERT INTO private.supplier_webhook_events(id,provider) VALUES($1,'gelato') ON CONFLICT DO NOTHING RETURNING id", [eventId]);
    if (!fresh.rowCount) return Response.json({ duplicate: true });
    const so = (
      await getPool().query(
        "SELECT id FROM private.supplier_orders WHERE provider='gelato' AND (($1::text IS NOT NULL AND supplier_order_id=$1) OR ($2::text IS NOT NULL AND reference_id=$2)) LIMIT 1",
        [parsed.orderId, parsed.reference],
      )
    ).rows[0];
    if (!so) return Response.json({ ignored: true });
    try {
      await syncSupplierOrder(so.id);
    } catch {
      // Allow redelivery: forget the event so a retry is processed.
      await getPool().query("DELETE FROM private.supplier_webhook_events WHERE id=$1", [eventId]);
      return Response.json({ error: "Sync failed; retry." }, { status: 503 });
    }
    runMarketplaceFollowUp();
    return Response.json({ received: true });
  } catch {
    return Response.json({ error: "Webhook could not be processed." }, { status: 500 });
  }
}
