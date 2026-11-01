import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { applyMarketPayment } from "@/lib/marketplace";
import { customerOrder, customerRequest } from "@/lib/gelato/orders";
import { stripeClient } from "@/lib/billing";
import {
  session,
  sameOrigin,
  body,
  failure,
  uuid,
  integer,
  ApiError,
  string,
} from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const { token } = await session();
    const id = request.nextUrl.searchParams.get("order");
    if (id)
      return Response.json(await customerOrder(uuid(id), token), {
        headers: { "Cache-Control": "no-store" },
      });
    const page = integer(
      Number(request.nextUrl.searchParams.get("page") || 0),
      "page",
      0,
      10000,
    );
    const { rows } = await getPool().query(
      "SELECT o.id,o.order_number,o.status,o.payment_status,o.total_cents,o.created_at,o.updated_at,so.status AS fulfillment_status FROM private.marketplace_orders o LEFT JOIN private.supplier_orders so ON so.order_id=o.id WHERE o.user_id=$1 ORDER BY o.created_at DESC LIMIT 25 OFFSET $2",
      [token, page * 25],
    );
    return Response.json(
      { orders: rows, page },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token } = await session(),
      input = await body(request);
    if (input.action === "request") {
      const id = uuid(input.orderId);
      const owned = await getPool().query(
        "SELECT 1 FROM private.marketplace_orders WHERE id=$1 AND user_id=$2",
        [id, token],
      );
      if (!owned.rows.length) throw new ApiError("Order not found.", 404);
      const kind =
        input.kind === "cancel" || input.kind === "return" ? input.kind : "support";
      return Response.json(
        await customerRequest(id, kind, string(input.message || "", "message", 1000, 0), token),
      );
    }
    if (input.action !== "refresh" && input.action !== "resume")
      throw new ApiError("Invalid order action.");
    const id = uuid(input.orderId);
    const { rows } = await getPool().query(
      "SELECT stripe_session_id FROM private.marketplace_orders WHERE id=$1 AND user_id=$2",
      [id, token],
    );
    if (!rows[0]) throw new ApiError("Order not found.", 404);
    if (rows[0].stripe_session_id) {
      const stripe = await stripeClient(),
        s = await stripe.checkout.sessions.retrieve(rows[0].stripe_session_id);
      if (
        input.action === "resume" &&
        s.status === "open" &&
        s.payment_status !== "paid" &&
        s.url
      )
        return Response.json({ url: s.url });
      await applyMarketPayment(
        s,
        `reconcile:${s.id}:${s.status}:${s.payment_status}`,
      );
    }
    return Response.json(await customerOrder(id, token));
  } catch (e) {
    return failure(e);
  }
}
