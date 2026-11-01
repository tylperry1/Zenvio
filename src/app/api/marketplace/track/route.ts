import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { body, email, failure, sameOrigin, string, ApiError } from "@/lib/server";
import { customerRequest, orderForGuestToken, requestGuestLink } from "@/lib/gelato/orders";
import { sendAccountMail } from "@/lib/mail";
import { getPool } from "@/lib/db";
import { stripeClient } from "@/lib/billing";
import { applyMarketPayment } from "@/lib/marketplace";
export const dynamic = "force-dynamic";

// Guest order access. The token arrives in a header (read from the URL
// fragment by the page) or the httpOnly cookie set at checkout; it is never
// placed in a query string.
async function token(request: NextRequest) {
  return request.headers.get("x-order-token") || (await cookies()).get("zv_guest_order")?.value || "";
}
export async function GET(request: NextRequest) {
  try {
    const t = await token(request);
    if (!t) throw new ApiError("Open the link from your order email, or look up your order below.", 404);
    return Response.json({ order: await orderForGuestToken(t) }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const input = await body(request);
    if (input.action === "lookup") {
      const address = email(input.email);
      const number = string(input.orderNumber, "order number", 20, 6).toUpperCase();
      if (!/^ZV-[A-F0-9]{10}$/.test(number)) throw new ApiError("Enter the order number from your confirmation email (for example ZV-1A2B3C4D5E).");
      const client = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
      await requestGuestLink(address, number, client, (to, url) => sendAccountMail(to, "Your Zenvio order link", url));
      return Response.json({ ok: true, message: "If that order exists, we've emailed a secure link to view it. The link expires in 24 hours." });
    }
    if (input.action === "refresh") {
      // Reconciles payment directly with Stripe in case the webhook is delayed.
      const order = await orderForGuestToken(await token(request));
      const sid = (await getPool().query("SELECT stripe_session_id FROM private.marketplace_orders WHERE id=$1", [order.id])).rows[0]?.stripe_session_id;
      if (sid && order.payment_status === "pending") {
        const s = await (await stripeClient()).checkout.sessions.retrieve(sid);
        await applyMarketPayment(s, `reconcile:${s.id}:${s.status}:${s.payment_status}`);
      }
      return Response.json({ order: await orderForGuestToken(await token(request)) });
    }
    if (input.action === "request") {
      const order = await orderForGuestToken(await token(request));
      const kind = input.kind === "cancel" || input.kind === "return" ? input.kind : "support";
      return Response.json(await customerRequest(order.id, kind, string(input.message || "", "message", 1000, 0), null));
    }
    throw new ApiError("Unknown action.");
  } catch (e) {
    return failure(e);
  }
}
