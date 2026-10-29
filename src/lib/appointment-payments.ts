import { getPool } from "./db";
import { stripeClient } from "./billing";
import {
  integrationValue,
  sealSecret,
  unsealSecret,
} from "./platform-settings";
import { ApiError, string, email } from "./server";
import { filterGoogleSlots } from "./google-calendar";
import { scheduleBooking, appOrigin, queueDelivery } from "./lifecycle";
export async function appointmentPaymentsReady() {
  return (
    process.env.APPOINTMENT_PAYMENTS_ENABLED === "true" &&
    Boolean(await integrationValue("STRIPE_CONNECT_WEBHOOK_SECRET")) &&
    Boolean(await integrationValue("STRIPE_SECRET_KEY"))
  );
}
export async function createAppointmentCheckout(
  host: string,
  event: string,
  start: string,
  input: any,
) {
  if (!(await appointmentPaymentsReady()))
    throw new ApiError(
      "Appointment payments are not configured. No payment has been taken.",
      503,
    );
  if (!(await filterGoogleSlots(host, event, [start])).length)
    throw new ApiError("This time is unavailable.", 409);
  const stripe = await stripeClient(),
    db = await getPool().connect();
  let payment: any, e: any, account: any;
  try {
    await db.query("BEGIN");
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended(id::text,0)) FROM public.profiles WHERE slug=$1",
      [host],
    );
    e = (
      await db.query(
        "SELECT e.*,p.id owner_id,p.timezone FROM public.event_types e JOIN public.profiles p ON p.id=e.user_id WHERE p.slug=$1 AND e.slug=$2 AND e.active AND e.deleted_at IS NULL FOR SHARE OF e",
        [host, event],
      )
    ).rows[0];
    if (!e || e.payment_mode === "free")
      throw new ApiError("Payment is not required for this type.", 409);
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      e.owner_id,
    ]);
    if (
      !(
        await db.query(
          "SELECT 1 FROM public.public_slots($1,$2,($3::timestamptz AT TIME ZONE $4)::date) WHERE starts_at=$3",
          [host, event, start, e.timezone],
        )
      ).rowCount
    )
      throw new ApiError("This time was just booked.", 409);
    account = (
      await db.query(
        "SELECT * FROM private.host_payment_accounts WHERE user_id=$1 AND disconnected_at IS NULL",
        [e.owner_id],
      )
    ).rows[0];
    if (!account)
      throw new ApiError("The host has not connected a payment account.", 409);
    const live = await stripe.accounts.retrieve(account.account_id);
    if (!live.charges_enabled || !live.payouts_enabled)
      throw new ApiError(
        "The host’s payment account is not ready to accept payments.",
        409,
      );
    const amount =
      e.payment_mode === "deposit" ? e.deposit_cents : e.price_cents;
    if (amount < 50 || amount > e.price_cents || e.price_cents > 99999999)
      throw new ApiError("The host must review this appointment price.", 409);
    await db.query(
      "UPDATE private.appointment_payments SET status='expired' WHERE user_id=$1 AND status IN ('held','pending') AND hold_expires_at<=now()",
      [e.owner_id],
    );
    const guest = {
      name: string(input.name, "name", 100, 2),
      email: email(input.email),
      phone: string(input.phone || "", "phone", 40, 0),
      company: string(input.company || "", "company", 100, 0),
      purpose: string(input.purpose || "", "purpose", 500, 0),
      notes: string(input.notes || "", "notes", 2000, 0),
      intake: input.snapshot || [],
    };
    payment = (
      await db.query(
        "INSERT INTO private.appointment_payments(user_id,event_id,account_id,status,amount_cents,total_cents,starts_at,ends_at,hold_expires_at,guest_ciphertext,policy_snapshot,buffer_minutes) VALUES($1,$2,$3,'held',$4,$5,$6,$6::timestamptz+make_interval(mins=>$7),now()+interval '31 minutes',$8,$9,$10) RETURNING *",
        [
          e.owner_id,
          e.id,
          account.account_id,
          amount,
          e.price_cents,
          start,
          e.duration,
          sealSecret(JSON.stringify(guest)),
          e.refund_policy,
          e.buffer,
        ],
      )
    ).rows[0];
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    db.release();
  }
  try {
    const feeBps = Number(process.env.CONNECT_FEE_BPS || 0);
    if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000)
      throw new ApiError(
        "Platform commission configuration requires review.",
        503,
      );
    const checkout = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        allowed_payment_method_types: ["card"],
        expires_at: Math.floor(
          new Date(payment.hold_expires_at).getTime() / 1000,
        ),
        customer_email: input.email,
        metadata: { zenvio_appointment_payment: payment.id },
        payment_intent_data: {
          metadata: { zenvio_appointment_payment: payment.id },
          ...(feeBps
            ? {
                application_fee_amount: Math.floor(
                  (payment.amount_cents * feeBps) / 10000,
                ),
              }
            : {}),
        },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: payment.amount_cents,
              product_data: {
                name:
                  e.title + (e.payment_mode === "deposit" ? " · deposit" : ""),
              },
            },
          },
        ],
        success_url:
          appOrigin() + "/book/" + host + "/" + event + "?payment=processing",
        cancel_url:
          appOrigin() + "/book/" + host + "/" + event + "?payment=cancelled",
      },
      {
        stripeAccount: account.account_id,
        idempotencyKey: "appointment-checkout-" + payment.id,
      },
    );
    await getPool().query(
      "UPDATE private.appointment_payments SET checkout_id=$2,status='pending' WHERE id=$1",
      [payment.id, checkout.id],
    );
    return { url: checkout.url, paymentId: payment.id };
  } catch (err) {
    await getPool().query(
      "UPDATE private.appointment_payments SET last_error='Checkout creation requires review.' WHERE id=$1",
      [payment.id],
    );
    throw err;
  }
}
export async function reconcileAppointmentPayment(
  account: string,
  checkoutId: string,
  eventId: string,
  eventType?: string,
) {
  const stripe = await stripeClient();
  const checkout = await stripe.checkout.sessions.retrieve(
    checkoutId,
    {},
    { stripeAccount: account },
  );
  const id = checkout.metadata?.zenvio_appointment_payment;
  if (!id || !/^[a-f0-9-]{36}$/i.test(id)) return;
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended(user_id::text,0)) FROM private.appointment_payments WHERE id=$1 AND account_id=$2",
      [id, account],
    );
    const p = (
      await db.query(
        "SELECT * FROM private.appointment_payments WHERE id=$1 AND account_id=$2 FOR UPDATE",
        [id, account],
      )
    ).rows[0];
    if (!p) {
      await db.query("COMMIT");
      return;
    }
    if (p.checkout_id !== checkoutId)
      throw Error("Appointment payment binding mismatch");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      p.user_id,
    ]);
    if (
      (
        await db.query(
          "SELECT 1 FROM private.appointment_payment_events WHERE account_id=$1 AND event_id=$2",
          [account, eventId],
        )
      ).rowCount
    ) {
      await db.query("COMMIT");
      return;
    }
    if (checkout.payment_status === "paid" && !p.booking_id) {
      if (
        checkout.amount_total !== p.amount_cents ||
        checkout.currency !== p.currency
      )
        throw Error("Appointment payment amount mismatch");
      const guest = JSON.parse(unsealSecret(p.guest_ciphertext));
      const taken = (
        await db.query(
          "SELECT 1 FROM public.bookings WHERE user_id=$1 AND status='confirmed' AND tstzrange(starts_at,blocked_until,'[)')&&tstzrange($2::timestamptz,$3::timestamptz+make_interval(mins=>$4),'[)')",
          [p.user_id, p.starts_at, p.ends_at, p.buffer_minutes],
        )
      ).rowCount;
      if (taken || new Date(p.starts_at).getTime() <= Date.now()) {
        await db.query(
          "UPDATE private.appointment_payments SET status='paid',payment_intent=$2,last_error='Payment received but slot unavailable. Host must review and refund or arrange another appointment.' WHERE id=$1",
          [p.id, checkout.payment_intent],
        );
        const owner = (
          await db.query('SELECT email FROM public."user" WHERE id=$1', [
            p.user_id,
          ])
        ).rows[0];
        if (owner)
          await queueDelivery(db, {
            user: p.user_id,
            kind: "payment_review",
            key: "payment-review:" + p.id,
            to: owner.email,
            subject: "Appointment payment requires review",
            text:
              "Payment was received but the slot could not be confirmed. Review Appointment payments to arrange a new time or issue an authorized refund. No automatic refund or cancellation was made. " +
              appOrigin() +
              "/app/payments",
          });
        await queueDelivery(db, {
          user: p.user_id,
          kind: "payment_review",
          key: "payment-review-guest:" + p.id,
          to: guest.email,
          subject: "Payment received — appointment awaiting host review",
          text: "Your payment was received, but an appointment could not be confirmed at the requested time. The host has been notified to arrange a time or review a refund. Please do not pay again.",
        });
      } else {
        await db.query(
          "UPDATE private.appointment_payments SET status='paid' WHERE id=$1",
          [p.id],
        );
        const booking = (
          await db.query(
            "INSERT INTO public.bookings(user_id,event_id,guest_name,guest_email,notes,guest_phone,guest_company,meeting_purpose,starts_at,ends_at,blocked_until,intake_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10::timestamptz+make_interval(mins=>$11),$12) RETURNING id",
            [
              p.user_id,
              p.event_id,
              guest.name,
              guest.email,
              guest.notes,
              guest.phone,
              guest.company,
              guest.purpose,
              p.starts_at,
              p.ends_at,
              p.buffer_minutes,
              JSON.stringify(guest.intake),
            ],
          )
        ).rows[0];
        await db.query(
          "INSERT INTO public.contacts(user_id,name,email,company) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,email) DO NOTHING",
          [p.user_id, guest.name, guest.email, guest.company],
        );
        await db.query(
          "UPDATE public.bookings b SET contact_id=c.id FROM public.contacts c WHERE b.id=$1 AND c.user_id=b.user_id AND c.email=b.guest_email",
          [booking.id],
        );
        await db.query(
          "UPDATE private.appointment_payments SET status='paid',booking_id=$2,payment_intent=$3,guest_ciphertext='',last_error=NULL WHERE id=$1",
          [p.id, booking.id, checkout.payment_intent],
        );
        await scheduleBooking(db, booking.id);
      }
    } else if (
      eventType === "checkout.session.async_payment_failed" &&
      checkout.payment_status !== "paid" &&
      !p.booking_id
    )
      await db.query(
        "UPDATE private.appointment_payments SET status='failed',last_error='Payment failed. No appointment was confirmed.' WHERE id=$1",
        [p.id],
      );
    else if (checkout.status === "expired" && !p.booking_id)
      await db.query(
        "UPDATE private.appointment_payments SET status='expired',guest_ciphertext='' WHERE id=$1",
        [p.id],
      );
    await db.query(
      "INSERT INTO private.appointment_payment_events(account_id,event_id) VALUES($1,$2)",
      [account, eventId],
    );
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}

// Reconcile provider refunds from the connected account, including refunds made in Stripe.
export async function reconcileAppointmentRefunds(
  account: string,
  intent: string,
  eventId: string,
) {
  const stripe = await stripeClient(),
    refunds = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await stripe.refunds.list(
      {
        payment_intent: intent,
        limit: 100,
        ...(cursor ? { starting_after: cursor } : {}),
      },
      { stripeAccount: account },
    );
    refunds.push(...page.data);
    if (!page.has_more) break;
    cursor = page.data.at(-1)?.id;
    if (!cursor) throw Error("Refund pagination failed");
  }
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    const p = (
      await db.query(
        "SELECT * FROM private.appointment_payments WHERE account_id=$1 AND payment_intent=$2 FOR UPDATE",
        [account, intent],
      )
    ).rows[0];
    if (!p) {
      await db.query("COMMIT");
      return;
    }
    if (
      (
        await db.query(
          "SELECT 1 FROM private.appointment_payment_events WHERE account_id=$1 AND event_id=$2",
          [account, eventId],
        )
      ).rowCount
    ) {
      await db.query("COMMIT");
      return;
    }
    let total = 0;
    for (const r of refunds) {
      const status =
        r.status === "succeeded"
          ? "succeeded"
          : ["failed", "canceled"].includes(r.status || "")
            ? "failed"
            : "pending";
      if (status === "succeeded") total += r.amount;
      const localId = r.metadata?.zenvio_refund_id;
      if (localId && /^[a-f0-9-]{36}$/i.test(localId))
        await db.query(
          "UPDATE private.appointment_refunds SET stripe_refund_id=$3,status=$4 WHERE id=$1 AND payment_id=$2 AND (stripe_refund_id IS NULL OR stripe_refund_id=$3)",
          [localId, p.id, r.id, status],
        );
      await db.query(
        "INSERT INTO private.appointment_refunds(payment_id,amount_cents,stripe_refund_id,status,reason) VALUES($1,$2,$3,$4,'Reconciled from connected Stripe account') ON CONFLICT(stripe_refund_id) DO UPDATE SET status=$4",
        [p.id, r.amount, r.id, status],
      );
    }
    if (total > p.amount_cents)
      throw Error("Refund total exceeds bound payment");
    await db.query(
      "UPDATE private.appointment_payments SET refunded_cents=$2,status=CASE WHEN $2=amount_cents THEN 'refunded' WHEN $2>0 THEN 'partially_refunded' ELSE status END WHERE id=$1",
      [p.id, total],
    );
    await db.query(
      "INSERT INTO private.appointment_payment_events(account_id,event_id) VALUES($1,$2)",
      [account, eventId],
    );
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
