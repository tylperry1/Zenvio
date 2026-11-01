import { NextRequest } from "next/server";
import { allowRequest, clientIp } from "@/lib/booking-protection";
import { guestOrderDetail } from "@/lib/marketplace";
import { ApiError, body, failure, sameOrigin } from "@/lib/server";

export const dynamic = "force-dynamic";

// POST so the private order token never appears in a URL or server log.
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    if (!(await allowRequest("market-guest-order", clientIp(request), 60, 3600))) throw new ApiError("Too many requests. Please try again later.", 429);
    const input = await body(request);
    return Response.json(await guestOrderDetail(input.token), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    return failure(error);
  }
}
