import { NextRequest } from "next/server";
import { allowRequest, clientIp } from "@/lib/booking-protection";
import { guestOrderDetail } from "@/lib/marketplace";
import { ApiError, body, email, failure, sameOrigin, string } from "@/lib/server";
import { customerFulfillment, customerRequest, guestOrderId, requestGuestLink, canRequestCancellation } from "@/lib/gelato/orders";
import { sendAccountMail } from "@/lib/mail";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";
const noStore = { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } };

// POST so the private order token never appears in a URL or server log.
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    if (!(await allowRequest("market-guest-order", clientIp(request), 60, 3600))) throw new ApiError("Too many requests. Please try again later.", 429);
    const input = await body(request);
    if (input.action === "lookup") {
      // Emails the private link; the response never reveals whether the order exists.
      const address = email(input.email);
      const number = string(input.orderNumber, "order number", 20, 6).toUpperCase();
      if (!/^ZV-[A-F0-9]{10}$/.test(number)) throw new ApiError("Enter the order number from your confirmation email (for example ZV-1A2B3C4D5E).");
      if (!(await allowRequest("market-guest-lookup", clientIp(request), 10, 3600)) || !(await allowRequest("market-guest-lookup-email", address, 5, 3600)))
        throw new ApiError("Too many lookups. Please try again later.", 429);
      await requestGuestLink(address, number, (to, url) => sendAccountMail(to, "Your Zenvio order link", url));
      return Response.json({ ok: true, message: "If that order exists, we've emailed its private link to you." }, noStore);
    }
    if (input.action === "request") {
      const id = await guestOrderId(input.token);
      const kind = input.kind === "cancel" || input.kind === "return" ? input.kind : "support";
      return Response.json(await customerRequest(id, kind, string(input.message || "", "message", 1000, 0), null), noStore);
    }
    const order = await guestOrderDetail(input.token);
    // Customer-safe production and tracking details for supplier-fulfilled items.
    const [fulfillment, extra] = await Promise.all([
      customerFulfillment(order.id),
      getPool().query("SELECT order_number FROM private.marketplace_orders WHERE id=$1", [order.id]),
    ]);
    return Response.json(
      { ...order, order_number: extra.rows[0]?.order_number || null, fulfillment, cancellable: canRequestCancellation(order.status, order.payment_status, fulfillment?.status) },
      noStore,
    );
  } catch (error) {
    return failure(error);
  }
}
