import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool } from '../db';
import { ApiError } from '../server';
import { stripeClient } from '../billing';
import { integrationValue, sealSecret } from '../platform-settings';
import { queueDelivery, appOrigin } from '../lifecycle';
import { applyBalanceEntry } from './balances';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function discountedPrice(cents: number, percent: number) { if (!Number.isSafeInteger(cents) || cents < 50 || !Number.isInteger(percent) || percent < 0 || percent > 90)
    throw new ApiError('Invalid offer pricing.'); const price = cents - Math.floor(cents * percent / 100); if (price < 50)
    throw new ApiError('Discounted prices must be at least $0.50.'); return price; }
export async function growthCheckoutReady() { const key = await integrationValue('STRIPE_SECRET_KEY'), secret = await integrationValue('STRIPE_GROWTH_WEBHOOK_SECRET'); return process.env.GROWTH_CHECKOUT_ENABLED === 'true' && process.env.GROWTH_RELEASE_VALIDATED === 'true' && Boolean(key && secret) && (key.startsWith('sk_test_') || process.env.GROWTH_LIVE_ENABLED === 'true'); }
export async function createGrowthCheckout(input: {
    offerId: string;
    reference: string;
    name: string;
    email: string;
    recipientEmail: string;
    coupon: string;
}) {
    if (!await growthCheckoutReady())
        throw new ApiError('Customer-product checkout has not passed release validation. No payment was taken.', 503);
    const pool = getPool(), stripe = await stripeClient();
    const offer = (await pool.query('select o.*,h.account_id,h.charges_enabled from private.growth_offers o join private.host_payment_accounts h on h.user_id=o.user_id and h.disconnected_at is null where o.id=$1 and o.active', [input.offerId])).rows[0];
    if (!offer || !offer.charges_enabled)
        throw new ApiError('This offer is unavailable for payment.', 409);
    const digest = hash(JSON.stringify(input)), db = await pool.connect();
    try {
        await db.query('begin');
        await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))', ['growth-checkout:' + offer.user_id]);
        let order = (await db.query('select * from private.growth_orders where user_id=$1 and reference=$2 for update', [offer.user_id, input.reference])).rows[0];
        if (order && order.digest !== digest)
            throw new ApiError('Checkout reference was used for different details.', 409);
        if (order && order.state !== 'pending')
            throw new ApiError('This checkout is already completed or expired.', 409);
        if (!order) {
            if (offer.kind === 'membership' && (await db.query("select 1 from private.growth_orders o left join private.growth_memberships m on m.order_id=o.id where o.user_id=$1 and o.offer_id=$2 and o.snapshot->>'email'=$3 and (o.state='pending' or m.status in ('active','trialing','past_due','unpaid','incomplete')) limit 1", [offer.user_id, offer.id, input.email])).rowCount)
                throw new ApiError('A membership or its checkout already exists for this client.', 409);
            const current = (await db.query('select * from private.growth_offers where id=$1 and user_id=$2 and active for share', [offer.id, offer.user_id])).rows[0];
            if (!current || current.price_cents !== offer.price_cents || current.credit_units !== offer.credit_units)
                throw new ApiError('Offer changed. Review its current price.', 409);
            let coupon: any = null, amount = offer.price_cents;
            if (input.coupon) {
                if (offer.kind !== 'package')
                    throw new ApiError('Coupons currently apply only to prepaid service packages.', 409);
                coupon = (await db.query('select * from private.growth_coupons where user_id=$1 and code=$2 and active and expires_at>now() for update', [offer.user_id, input.coupon])).rows[0];
                if (!coupon)
                    throw new ApiError('Coupon is invalid or expired.', 409);
                const used = Number((await db.query("select count(*) n from private.growth_orders where coupon_id=$1 and state in ('paid','pending')", [coupon.id])).rows[0].n);
                if (used >= coupon.maximum_uses)
                    throw new ApiError('Coupon redemption limit reached.', 409);
                amount = discountedPrice(offer.price_cents, coupon.percent_off);
            }
            const contact = (await db.query('insert into public.contacts(user_id,name,email) values($1,$2,$3) on conflict(user_id,email) do update set email=excluded.email returning id', [offer.user_id, input.name, input.email])).rows[0];
            order = (await db.query('insert into private.growth_orders(user_id,offer_id,contact_id,reference,digest,snapshot,amount_cents,recipient_email,stripe_account_id,coupon_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *', [offer.user_id, offer.id, contact.id, input.reference, digest, JSON.stringify({ kind: offer.kind, title: offer.title, credits: offer.credit_units, unit: offer.unit, name: input.name, email: input.email, priceCents: offer.price_cents }), amount, input.recipientEmail, offer.account_id, coupon?.id || null])).rows[0];
        }
        if (new Date(order.expires_at).getTime() <= Date.now())
            throw new ApiError('This checkout expired. Start a new checkout.', 409);
        // Persist the immutable order before any provider operation. Retried requests reuse its stable provider key.
        await db.query('commit');
        await db.query('begin');
        await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))', ['growth-checkout:' + offer.user_id]);
        order = (await db.query('select * from private.growth_orders where id=$1 for update', [order.id])).rows[0];
        if (order.state !== 'pending' || new Date(order.expires_at).getTime() <= Date.now())
            throw new ApiError('This checkout has completed or expired.', 409);
        const snapshot = order.snapshot;
        if (order.stripe_session_id) {
            const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id, {}, { stripeAccount: order.stripe_account_id });
            if (session.status === 'open' && session.url) {
                await db.query('commit');
                return { url: session.url, orderId: order.id };
            }
            throw new ApiError('This checkout is no longer open. Refresh its payment status.', 409);
        }
        const metadata = { zenvio_growth_order: order.id, zenvio_owner: order.user_id };
        const session = await stripe.checkout.sessions.create({ mode: snapshot.kind === 'membership' ? 'subscription' : 'payment', customer_email: snapshot.email, line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: order.amount_cents, product_data: { name: snapshot.title }, ...(snapshot.kind === 'membership' ? { recurring: { interval: 'month' as const } } : {}) } }], metadata, ...(snapshot.kind === 'membership' ? { subscription_data: { metadata } } : { payment_intent_data: { metadata } }), success_url: appOrigin() + '/purchase/complete', cancel_url: appOrigin() + '/purchase/complete', expires_at: Math.floor(new Date(order.expires_at).getTime() / 1000) }, { stripeAccount: order.stripe_account_id, idempotencyKey: 'growth-checkout:' + order.id });
        if (!session.url)
            throw new ApiError('Checkout could not be confirmed.', 503);
        await db.query('update private.growth_orders set stripe_session_id=$2 where id=$1', [order.id, session.id]);
        await db.query('commit');
        return { url: session.url, orderId: order.id };
    }
    catch (e) {
        await db.query('rollback');
        throw e;
    }
    finally {
        db.release();
    }
}
async function creditAccount(db: PoolClient, order: any, credits: number, reference: string) {
    const kind = order.snapshot.kind === 'gift_card' ? 'gift_card' : 'package';
    const account = (await db.query('insert into private.customer_balance_accounts(user_id,contact_id,kind,unit) values($1,$2,$3,$4) on conflict(user_id,contact_id,kind,unit) do update set unit=$4 returning id', [order.user_id, order.contact_id, kind, order.snapshot.unit])).rows[0];
    const entry = await applyBalanceEntry(db, { userId: order.user_id, accountId: account.id, delta: credits, reference, reason: 'Verified customer payment: ' + order.snapshot.title });
    return { accountId: account.id, entryId: entry.id };
}
export async function settleGrowthPayment(db: PoolClient, order: any, reference: string, paymentIntentId: string, amount: number) {
    if (amount !== order.amount_cents || amount < 50)
        throw new ApiError('Payment amount does not match the immutable order.', 409);
    const prior = (await db.query('select id from private.growth_settlements where user_id=$1 and provider_reference=$2', [order.user_id, reference])).rows[0];
    if (prior)
        return;
    const settlement = (await db.query('insert into private.growth_settlements(order_id,user_id,provider_reference,payment_intent_id,amount_paid_cents,credits) values($1,$2,$3,$4,$5,$6) returning id', [order.id, order.user_id, reference, paymentIntentId, amount, order.snapshot.credits])).rows[0];
    if (order.snapshot.kind === 'gift_card') {
        const code = randomBytes(24).toString('hex');
        await db.query('insert into private.growth_gift_cards(order_id,settlement_id,user_id,code_hash,code_ciphertext,value) values($1,$2,$3,$4,$5,$6)', [order.id, settlement.id, order.user_id, hash(code), sealSecret(code), order.snapshot.credits]);
        await queueDelivery(db, { user: order.user_id, kind: 'gift_card_issued', key: 'gift-card:' + order.id, to: order.recipient_email, subject: 'Your gift card: ' + order.snapshot.title, text: `A gift card has been purchased for you.\nValue: ${order.snapshot.credits} ${order.snapshot.unit} minor units.\nPrivate redemption code: ${code}\nKeep this code private and redeem it at ${appOrigin()}/gift-card.` });
    }
    else {
        const entry = await creditAccount(db, order, order.snapshot.credits, 'growth-grant:' + settlement.id);
        await db.query('update private.growth_settlements set balance_account_id=$2,grant_entry_id=$3 where id=$1', [settlement.id, entry.accountId, entry.entryId]);
    }
    await db.query("update private.growth_orders set state='paid',paid_at=coalesce(paid_at,now()),payment_intent_id=coalesce(payment_intent_id,$2) where id=$1", [order.id, paymentIntentId]);
}
export async function redeemGiftCard(input: {
    code: string;
    name: string;
    email: string;
}) {
    const db = await getPool().connect();
    try {
        await db.query('begin');
        const card = (await db.query('select g.*,o.snapshot from private.growth_gift_cards g join private.growth_orders o on o.id=g.order_id where code_hash=$1 for update of g', [hash(input.code)])).rows[0];
        if (!card || card.state === 'void')
            throw new ApiError('Gift card is unavailable.', 404);
        if (card.state === 'redeemed') {
            const c = (await db.query('select email from public.contacts where id=$1 and user_id=$2', [card.contact_id, card.user_id])).rows[0];
            if (c?.email !== input.email)
                throw new ApiError('This gift card has already been redeemed.', 409);
            await db.query('commit');
            return { redeemed: true, duplicate: true };
        }
        const contact = (await db.query('insert into public.contacts(user_id,name,email) values($1,$2,$3) on conflict(user_id,email) do update set email=excluded.email returning id', [card.user_id, input.name, input.email])).rows[0];
        const entry = await creditAccount(db, { user_id: card.user_id, contact_id: contact.id, snapshot: card.snapshot }, card.value, 'gift-redemption:' + card.id);
        await db.query("update private.growth_gift_cards set state='redeemed',contact_id=$2,balance_account_id=$3,redeemed_at=now() where id=$1", [card.id, contact.id, entry.accountId]);
        await db.query('update private.growth_settlements set balance_account_id=$2,grant_entry_id=$3 where id=$1', [card.settlement_id, entry.accountId, entry.entryId]);
        await db.query('commit');
        return { redeemed: true, duplicate: false };
    }
    catch (e) {
        await db.query('rollback');
        throw e;
    }
    finally {
        db.release();
    }
}
export async function recoverGrowthRefund(db: PoolClient, paymentIntentId: string, refundCents: number) {
    const rows = (await db.query('select * from private.growth_settlements where payment_intent_id=$1 order by id for update', [paymentIntentId])).rows;
    for (const s of rows) {
        if (refundCents <= s.refunded_cents)
            continue;
        if (refundCents > s.amount_paid_cents)
            throw new ApiError('Refund exceeds the recorded payment.', 409);
        const target = Math.floor(Number(s.credits) * refundCents / Number(s.amount_paid_cents)), delta = target - s.refunded_credits;
        let recovered = 0;
        if (s.balance_account_id) {
            const a = (await db.query('select * from private.customer_balance_accounts where id=$1 and user_id=$2 for update', [s.balance_account_id, s.user_id])).rows[0];
            if (!a)
                throw new ApiError('Refund credit account is missing.', 409);
            recovered = Math.min(Number(a.balance), delta);
            if (recovered) {
                const entry = await db.query('insert into private.customer_balance_entries(account_id,user_id,delta,balance_after,reference,reason) values($1,$2,$3,$4,$5,$6)', [a.id, s.user_id, -recovered, Number(a.balance) - recovered, 'growth-refund:' + s.id + ':' + refundCents, 'Verified Stripe refund credit recovery']);
                await db.query('update private.customer_balance_accounts set balance=$2,frozen=frozen or $3 where id=$1', [a.id, Number(a.balance) - recovered, recovered < delta]);
            }
            else if (delta)
                await db.query('update private.customer_balance_accounts set frozen=true where id=$1', [a.id]);
        }
        else {
            const card = (await db.query('select * from private.growth_gift_cards where settlement_id=$1 for update', [s.id])).rows[0];
            if (!card || card.state === 'redeemed')
                throw new ApiError('Gift-card refund requires reconciliation.', 409);
            recovered = Math.min(card.value, delta);
            await db.query("update private.growth_gift_cards set value=value-$2,state=case when value-$2=0 then 'void' else state end where id=$1", [card.id, recovered]);
        }
        await db.query('update private.growth_settlements set refunded_cents=$2,refunded_credits=$3,credit_debt=credit_debt+$4 where id=$1', [s.id, refundCents, target, delta - recovered]);
        await db.query("update private.growth_orders set state=case when $2 then 'disputed' when $3 then 'refunded' else state end where id=$1", [s.order_id, recovered < delta, refundCents === s.amount_paid_cents]);
    }
}
