import { NextRequest } from "next/server";
import { stripeClient } from "@/lib/billing";
import { integrationValue } from "@/lib/platform-settings";
import { processStripeEvent } from "@/lib/stripe-webhook";
import { stripeWebhookDeps } from "@/lib/stripe-webhook-runtime";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const secret = await integrationValue("STRIPE_WEBHOOK_SECRET");
  if (!secret) return Response.json({ error: "Webhook unavailable." }, { status: 503 });
  if (Number(request.headers.get("content-length")) > 1000000)
    return new Response(null, { status: 413 });
  const raw = await request.text();
  if (raw.length > 1000000) return new Response(null, { status: 413 });

  let event;
  try {
    event = (await stripeClient()).webhooks.constructEvent(
      raw,
      request.headers.get("stripe-signature") || "",
      secret,
    );
  } catch {
    return Response.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    const result = await processStripeEvent(event, await stripeWebhookDeps());
    // A duplicate delivery is acknowledged so Stripe stops retrying; the stored
    // event log remains the audit source for what was applied.
    return Response.json({ received: true, duplicate: result.duplicate });
  } catch {
    // Never include provider payloads or payment details in the response.
    return Response.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
