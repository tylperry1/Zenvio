import { NextRequest, after } from "next/server";
import { stripeClient } from "@/lib/billing";
import { integrationValue } from "@/lib/platform-settings";
import {
  reconcileAppointmentPayment,
  reconcileAppointmentRefunds,
} from "@/lib/appointment-payments";
import { getPool } from "@/lib/db";
import { deliverBookingEmails } from "@/lib/mail";
import { runGoogleJobs } from "@/lib/google-calendar";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const secret = await integrationValue("STRIPE_CONNECT_WEBHOOK_SECRET");
  if (!secret)
    return Response.json({ error: "Webhook unavailable." }, { status: 503 });
  const raw = await req.text();
  if (raw.length > 1000000) return new Response(null, { status: 413 });
  const stripe = await stripeClient();
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      raw,
      req.headers.get("stripe-signature") || "",
      secret,
    );
  } catch {
    return Response.json({ error: "Invalid signature." }, { status: 400 });
  }
  if (!event.account) return Response.json({ received: true });
  if (process.env.VERCEL_ENV === "production" && !event.livemode)
    return Response.json(
      { error: "Test events are not accepted in production." },
      { status: 400 },
    );
  try {
    if (event.type.startsWith("checkout.session."))
      await reconcileAppointmentPayment(
        event.account,
        (event.data.object as any).id,
        event.id,
        event.type,
      );
    else if (
      event.type === "charge.refunded" ||
      event.type.startsWith("refund.")
    ) {
      const object = event.data.object as any;
      const intent =
        typeof object.payment_intent === "string"
          ? object.payment_intent
          : object.payment_intent?.id;
      if (intent)
        await reconcileAppointmentRefunds(event.account, intent, event.id);
    } else if (event.type === "account.application.deauthorized")
      await getPool().query(
        "UPDATE private.host_payment_accounts SET disconnected_at=now(),charges_enabled=false,payouts_enabled=false WHERE account_id=$1",
        [event.account],
      );
    else if (event.type === "account.updated") {
      const a = await stripe.accounts.retrieve(event.account);
      await getPool().query(
        "UPDATE private.host_payment_accounts SET charges_enabled=$2,payouts_enabled=$3,details_submitted=$4 WHERE account_id=$1",
        [
          event.account,
          a.charges_enabled,
          a.payouts_enabled,
          a.details_submitted,
        ],
      );
    }
    after(() => deliverBookingEmails());
    after(() => runGoogleJobs().then(() => {}));
    return Response.json({ received: true });
  } catch {
    return Response.json(
      { error: "Webhook reconciliation failed." },
      { status: 500 },
    );
  }
}
