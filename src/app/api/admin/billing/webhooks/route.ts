import { NextRequest } from "next/server";
import { adminSession } from "@/lib/admin";
import { getPool } from "@/lib/db";
import { body, sameOrigin, failure, string } from "@/lib/server";
import { listStripeWebhookEvents, retryStripeWebhookEvent } from "@/lib/stripe-webhook";
import { stripeWebhookDeps } from "@/lib/stripe-webhook-runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    await adminSession();
    const limit = Number(request.nextUrl.searchParams.get("limit") || 50);
    const events = await listStripeWebhookEvents(getPool(), Number.isFinite(limit) ? limit : 50);
    return Response.json(
      {
        events,
        failed: events.filter((event) => event.status === "failed").length,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token } = await adminSession();
    const input = await body(request);
    const eventId = string(input.eventId, "webhook event", 200, 3);
    const result = await retryStripeWebhookEvent(
      getPool(),
      eventId,
      await stripeWebhookDeps(),
    );
    await getPool().query(
      "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'stripe-webhook-retry',$2)",
      [token, JSON.stringify({ eventId, ...result })],
    );
    return Response.json(result);
  } catch (error) {
    return failure(error);
  }
}
