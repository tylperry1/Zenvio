import { after } from "next/server";
import { deliverBookingEmails } from "@/lib/mail";
import { NextRequest } from "next/server";
import { backend, body, failure, sameOrigin, string } from "@/lib/server";
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const input = await body(request);
    await backend("/rest/v1/rpc/cancel_booking", {
      method: "POST",
      body: JSON.stringify({
        cancellation_token: string(input.token, "cancellation token", 100, 32),
      }),
    });
    after(() => deliverBookingEmails());
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
