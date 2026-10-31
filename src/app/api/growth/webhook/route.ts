import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { stripeClient } from '@/lib/billing';
import { integrationValue } from '@/lib/platform-settings';
import { settleGrowthPayment, recoverGrowthRefund } from '@/lib/launch/customer-commerce';
import { readUpload } from '@/lib/uploads';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
    const secret = await integrationValue('STRIPE_GROWTH_WEBHOOK_SECRET');
    if (!secret)
        return Response.json({ error: 'Webhook unavailable.' }, { status: 503 });
    const stripe = await stripeClient();
    let event: any;
    try {
        const raw = (await readUpload(request, 1000000)).toString('utf8');
        event = stripe.webhooks.constructEvent(raw, request.headers.get('stripe-signature') || '', secret);
    }
    catch {
        return Response.json({ error: 'Invalid webhook signature or payload.' }, { status: 400 });
    }
    if (!event.account)
        return Response.json({ received: true });
    const account = event.account, opts = { stripeAccount: account }, db = await getPool().connect();
    try {
        await db.query('begin');
        await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))', ['growth-event:' + event.id]);
        if ((await db.query('select 1 from private.growth_provider_events where provider_event_id=$1', [event.id])).rowCount) {
            await db.query('commit');
            return Response.json({ received: true });
        }
        const source = event.data.object;
        let order: any;
        if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded' || event.type === 'checkout.session.expired') {
            const checkout = await stripe.checkout.sessions.retrieve(source.id, {}, opts), id = checkout.metadata?.zenvio_growth_order;
            if (id) {
                order = (await db.query('select * from private.growth_orders where id=$1 and stripe_account_id=$2 for update', [id, account])).rows[0];
                if (!order || checkout.id !== order.stripe_session_id || checkout.currency !== 'usd' || checkout.amount_total !== order.amount_cents)
                    throw Error('invalid_growth_checkout');
                if (event.type === 'checkout.session.expired' && checkout.status === 'expired')
                    await db.query("update private.growth_orders set state='expired' where id=$1 and state='pending'", [order.id]);
                if (checkout.payment_status === 'paid' && checkout.mode === 'payment') {
                    const pi = typeof checkout.payment_intent === 'string' ? checkout.payment_intent : checkout.payment_intent?.id;
                    if (!pi || typeof checkout.amount_total !== 'number')
                        throw Error('missing_payment_intent_or_amount');
                    await settleGrowthPayment(db, order, 'checkout:' + checkout.id, pi, checkout.amount_total);
                }
            }
        }
        else if (['invoice.paid', 'invoice.payment_failed', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
            let invoice: any = null, sub: any;
            if (event.type.startsWith('invoice.')) {
                invoice = await stripe.invoices.retrieve(source.id, {}, opts);
                const subId = invoice.parent?.subscription_details?.subscription || invoice.subscription;
                if (subId)
                    sub = await stripe.subscriptions.retrieve(typeof subId === 'string' ? subId : subId.id, {}, opts);
            }
            else
                sub = await stripe.subscriptions.retrieve(source.id, {}, opts);
            const id = sub?.metadata?.zenvio_growth_order;
            if (id) {
                order = (await db.query('select * from private.growth_orders where id=$1 and stripe_account_id=$2 for update', [id, account])).rows[0];
                if (!order || order.snapshot.kind !== 'membership' || sub.metadata.zenvio_owner !== order.user_id)
                    throw Error('invalid_growth_membership');
                const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id, period = sub.items?.data?.[0]?.current_period_end;
                await db.query('insert into private.growth_memberships(order_id,user_id,stripe_subscription_id,stripe_customer_id,status,current_period_end) values($1,$2,$3,$4,$5,$6) on conflict(order_id) do update set status=$5,current_period_end=$6,updated_at=now()', [order.id, order.user_id, sub.id, customer, sub.status, period ? new Date(period * 1000) : null]);
                if (event.type === 'invoice.paid' && invoice.status === 'paid' && ['subscription_create', 'subscription_cycle'].includes(invoice.billing_reason)) {
                    const pi = invoice.payment_intent ? typeof invoice.payment_intent === 'string' ? invoice.payment_intent : invoice.payment_intent.id : null;
                    // Modern Stripe invoices expose payments separately; reconcile their real PaymentIntent.
                    let paymentIntent = pi;
                    if (!paymentIntent) {
                        const payments = await stripe.invoicePayments.list({ invoice: invoice.id, limit: 10 }, opts);
                        const matched = payments.data.find((p: any) => p.status === 'paid' && p.payment?.payment_intent)?.payment?.payment_intent;
                        paymentIntent = typeof matched === 'string' ? matched : matched?.id;
                    }
                    if (!paymentIntent || invoice.currency !== 'usd' || Number(invoice.amount_paid) !== order.amount_cents)
                        throw Error('membership_invoice_unreconciled');
                    await settleGrowthPayment(db, order, 'invoice:' + invoice.id, paymentIntent, invoice.amount_paid);
                }
            }
        }
        else if (event.type === 'charge.refunded') {
            const charge = await stripe.charges.retrieve(source.id, {}, opts), pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
            if (pi) {
                const owned = (await db.query('select 1 from private.growth_settlements s join private.growth_orders o on o.id=s.order_id where s.payment_intent_id=$1 and o.stripe_account_id=$2', [pi, account])).rowCount;
                if (owned)
                    await recoverGrowthRefund(db, pi, charge.amount_refunded);
            }
        }
        await db.query('insert into private.growth_provider_events(provider_event_id,account_id,type) values($1,$2,$3)', [event.id, account, event.type]);
        await db.query('commit');
        return Response.json({ received: true });
    }
    catch {
        await db.query('rollback');
        return Response.json({ error: 'Customer payment reconciliation failed; retry required.' }, { status: 500 });
    }
    finally {
        db.release();
    }
}
