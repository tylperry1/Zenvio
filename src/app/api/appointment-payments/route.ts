import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import {
  session,
  sameOrigin,
  body,
  failure,
  uuid,
  string,
  integer,
  ApiError,
} from "@/lib/server";
import { stripeClient } from "@/lib/billing";
import { appointmentPaymentsReady } from "@/lib/appointment-payments";
import { appOrigin } from "@/lib/lifecycle";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const { token } = await session();
    const [account, payments, events] = await Promise.all([
      getPool().query(
        "SELECT charges_enabled,payouts_enabled,details_submitted,disconnected_at FROM private.host_payment_accounts WHERE user_id=$1",
        [token],
      ),
      getPool().query(
        "SELECT id,booking_id,status,amount_cents,total_cents,refunded_cents,currency,policy_snapshot,last_error,created_at FROM private.appointment_payments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
        [token],
      ),
      getPool().query(
        "SELECT id,title,payment_mode,price_cents,deposit_cents,refund_policy FROM public.event_types WHERE user_id=$1 AND deleted_at IS NULL",
        [token],
      ),
    ]);
    return Response.json(
      {
        configured: await appointmentPaymentsReady(),
        account: account.rows[0] || null,
        payments: payments.rows,
        events: events.rows,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    sameOrigin(req);
    const { token, user } = await session(),
      v = await body(req);
    if (v.action === "price") {
      if (!["free", "full", "deposit"].includes(String(v.mode)))
        throw new ApiError("Choose a payment policy.");
      const price = integer(v.price, "price in cents", 0, 99999999),
        deposit = integer(v.deposit, "deposit in cents", 0, 99999999);
      if (
        v.mode !== "free" &&
        (price < 50 ||
          (v.mode === "deposit" && (deposit < 50 || deposit > price)))
      )
        throw new ApiError(
          "Paid amounts must be at least $0.50 and deposits cannot exceed the total.",
        );
      const r = await getPool().query(
        "UPDATE public.event_types SET payment_mode=$3,price_cents=$4,deposit_cents=$5,refund_policy=$6 WHERE id=$1 AND user_id=$2 RETURNING id",
        [
          uuid(v.id),
          token,
          v.mode,
          price,
          deposit,
          string(v.policy || "", "refund policy", 2000, 0),
        ],
      );
      if (!r.rowCount) throw new ApiError("Appointment type not found.", 404);
      return Response.json({ ok: true });
    }
    if (!(await appointmentPaymentsReady()))
      throw new ApiError(
        "Stripe Connect is not configured for appointment payments.",
        503,
      );
    const stripe = await stripeClient(),
      db = await getPool().connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "connect:" + token,
      ]);
      let account = (
        await db.query(
          "SELECT * FROM private.host_payment_accounts WHERE user_id=$1 FOR UPDATE",
          [token],
        )
      ).rows[0];
      let result: any = { ok: true };
      if (v.action === "onboard") {
        if (!account) {
          const a = await stripe.accounts.create(
            {
              type: "express",
              email: user.email,
              capabilities: {
                card_payments: { requested: true },
                transfers: { requested: true },
              },
              metadata: { zenvio_user_id: token },
            },
            { idempotencyKey: "zenvio-connect-" + token },
          );
          await db.query(
            "INSERT INTO private.host_payment_accounts(user_id,account_id) VALUES($1,$2)",
            [token, a.id],
          );
          account = { account_id: a.id };
        }
        const link = await stripe.accountLinks.create({
          account: account.account_id,
          refresh_url: appOrigin() + "/app/payments",
          return_url: appOrigin() + "/app/payments",
          type: "account_onboarding",
        });
        result.url = link.url;
      } else if (v.action === "refresh") {
        if (!account) throw new ApiError("Start host onboarding first.", 409);
        const a = await stripe.accounts.retrieve(account.account_id);
        await db.query(
          "UPDATE private.host_payment_accounts SET charges_enabled=$2,payouts_enabled=$3,details_submitted=$4,updated_at=now() WHERE user_id=$1",
          [token, a.charges_enabled, a.payouts_enabled, a.details_submitted],
        );
      } else if (v.action === "refund") {
        const p = (
          await db.query(
            "SELECT * FROM private.appointment_payments WHERE id=$1 AND user_id=$2 FOR UPDATE",
            [uuid(v.id), token],
          )
        ).rows[0];
        if (
          !p ||
          !p.payment_intent ||
          !["paid", "partially_refunded"].includes(p.status)
        )
          throw new ApiError("This payment cannot be refunded.", 409);
        const amount = integer(
            v.amount,
            "refund amount",
            1,
            p.amount_cents - p.refunded_cents,
          ),
          reason = string(v.reason, "refund reason", 500, 5);
        const pending = (
          await db.query(
            "SELECT * FROM private.appointment_refunds WHERE payment_id=$1 AND status='pending'",
            [p.id],
          )
        ).rows[0];
        let refund = pending;
        if (refund && refund.amount_cents !== amount)
          throw new ApiError(
            "A previous refund is pending. Reconcile it before creating another.",
            409,
          );
        if (!refund)
          refund = (
            await db.query(
              "INSERT INTO private.appointment_refunds(payment_id,amount_cents,actor_id,reason) VALUES($1,$2,$3,$4) RETURNING *",
              [p.id, amount, token, reason],
            )
          ).rows[0];
        await db.query("COMMIT");
        const external = refund.stripe_refund_id
          ? await stripe.refunds.retrieve(
              refund.stripe_refund_id,
              {},
              { stripeAccount: p.account_id },
            )
          : await stripe.refunds.create(
              {
                payment_intent: p.payment_intent,
                amount,
                metadata: { zenvio_refund_id: refund.id },
              },
              {
                stripeAccount: p.account_id,
                idempotencyKey: "appointment-refund-" + refund.id,
              },
            );
        await db.query("BEGIN");
        await db.query(
          "SELECT 1 FROM private.appointment_payments WHERE id=$1 FOR UPDATE",
          [p.id],
        );
        const claimed = await db.query(
          "UPDATE private.appointment_refunds SET stripe_refund_id=$2,status=$3 WHERE id=$1 AND status='pending' RETURNING id",
          [
            refund.id,
            external.id,
            external.status === "succeeded"
              ? "succeeded"
              : ["failed", "canceled"].includes(external.status || "")
                ? "failed"
                : "pending",
          ],
        );
        if (claimed.rowCount && external.status === "succeeded")
          await db.query(
            "UPDATE private.appointment_payments SET refunded_cents=refunded_cents+$2,status=CASE WHEN refunded_cents+$2=amount_cents THEN 'refunded' ELSE 'partially_refunded' END WHERE id=$1",
            [p.id, amount],
          );
        await db.query(
          "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'appointment_refund',$2)",
          [token, JSON.stringify({ paymentId: p.id, amount, reason })],
        );
      } else throw new ApiError("Invalid action.");
      await db.query("COMMIT");
      return Response.json(result);
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  } catch (e) {
    return failure(e);
  }
}
