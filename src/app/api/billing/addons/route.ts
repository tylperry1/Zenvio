import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { body, sameOrigin, session, failure, ApiError } from "@/lib/server";
import { getPool } from "@/lib/db";
import { stripeClient } from "@/lib/billing";
import { billingReadiness } from "@/lib/billing-readiness";
import { catalogVersion } from "@/lib/subscription-offers.mjs";
import { listBillingAddons } from "@/lib/billing-addons";
import { appOrigin } from "@/lib/lifecycle";

export const dynamic = "force-dynamic";

/** Shape allowed for one-time credit-pack checkout (not recurring SMS/storage/seats). */
function oneTimePack(offer: { recurring: boolean; unit: string }) {
  return !offer.recurring && offer.unit !== "smsSegments" && offer.unit !== "seats";
}

/** Ready for customer purchase: local available + Stripe price mapped + env gate elsewhere. */
function purchasable(offer: {
  recurring: boolean;
  unit: string;
  available: boolean;
  sync_status: string;
  stripe_price_id: string | null;
}) {
  return (
    oneTimePack(offer) &&
    offer.available === true &&
    offer.sync_status === "synced" &&
    Boolean(offer.stripe_price_id)
  );
}

async function checkoutReady() {
  return process.env.ADDON_BILLING_VALIDATED === "true" && (await billingReadiness()).checkoutEnabled;
}

export async function GET() {
  try {
    const { token } = await session();
    const db = getPool();
    const [orders, eligibility, ready, addons] = await Promise.all([
      db.query(
        "select id,addon,quantity,amount_cents,state,refunded_cents,created_at from private.subscription_addon_orders where billing_owner=$1 order by created_at desc limit 100",
        [token],
      ),
      db.query(
        "select 1 from private.subscriptions where user_id=$1 and catalog_version=$2 and status='active' and customer_id is not null",
        [token, catalogVersion],
      ),
      checkoutReady(),
      listBillingAddons(db),
    ]);
    const enabled = ready && eligibility.rows.length > 0;
    return Response.json(
      {
        orders: orders.rows,
        enabled,
        offers: addons.filter(oneTimePack).map((offer) => ({
          id: offer.id,
          name: offer.name,
          amount: offer.amount_cents,
          quantity: Number(offer.quantity),
          unit: offer.unit,
          recurring: offer.recurring,
          available: enabled && purchasable(offer),
          syncStatus: offer.sync_status,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    sameOrigin(req);
    const { token } = await session(),
      v = await body(req);
    const db = await getPool().connect();
    try {
      await db.query("begin");
      await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", ["billing:" + token]);
      const offer = (
        await db.query("SELECT * FROM private.billing_addons WHERE id=$1 FOR UPDATE", [String(v.addon || "")])
      ).rows[0];
      // Shape check first; env/checkout gate returns 503 before availability 409 (launch fixtures).
      if (!offer || !oneTimePack(offer) || v.confirm !== true) {
        throw new ApiError("This add-on is not available for purchase.", 409);
      }
      if (!(await checkoutReady())) {
        throw new ApiError("Add-on billing is being validated. No payment has been taken.", 503);
      }
      if (!purchasable(offer)) {
        throw new ApiError("This add-on is not available for purchase.", 409);
      }
      const sub = (
        await db.query("select * from private.subscriptions where user_id=$1 for update", [token])
      ).rows[0];
      if (!sub || sub.catalog_version !== catalogVersion || sub.status !== "active" || !sub.customer_id) {
        throw new ApiError("Only the active workspace billing owner can purchase additional capacity.", 403);
      }
      const stripe = await stripeClient();
      const pending = (
        await db.query(
          "select addon,checkout_id from private.subscription_addon_orders where billing_owner=$1 and state='pending' and checkout_id is not null order by created_at desc limit 20",
          [token],
        )
      ).rows;
      for (const order of pending) {
        const checkout = await stripe.checkout.sessions.retrieve(order.checkout_id);
        if (checkout.status === "open") {
          if (order.addon !== offer.id) {
            throw new ApiError("Complete or cancel your open add-on checkout before starting another.", 409);
          }
          await db.query("commit");
          return Response.json({ url: checkout.url });
        }
      }
      const id = randomUUID();
      await db.query(
        "insert into private.subscription_addon_orders(id,billing_owner,addon,meter,quantity,amount_cents,customer_id) values($1,$2,$3,$4,$5,$6,$7)",
        [id, token, offer.id, offer.unit, offer.quantity, offer.amount_cents, sub.customer_id],
      );
      const checkout = await stripe.checkout.sessions.create(
        {
          customer: sub.customer_id,
          mode: "payment",
          client_reference_id: token,
          metadata: { zenvio_addon_order: id },
          payment_intent_data: { metadata: { zenvio_addon_order: id } },
          line_items: [{ quantity: 1, price: offer.stripe_price_id }],
          success_url: appOrigin() + "/app/billing?addon=complete",
          cancel_url: appOrigin() + "/app/billing",
        },
        { idempotencyKey: "zenvio-addon:" + id },
      );
      await db.query("update private.subscription_addon_orders set checkout_id=$2 where id=$1", [
        id,
        checkout.id,
      ]);
      await db.query("commit");
      return Response.json({ url: checkout.url });
    } catch (e) {
      await db.query("rollback");
      throw e;
    } finally {
      db.release();
    }
  } catch (e) {
    return failure(e);
  }
}
