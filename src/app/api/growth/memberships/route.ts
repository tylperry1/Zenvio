import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { stripeClient } from '@/lib/billing';
import { ApiError, body, failure, sameOrigin, session, uuid } from '@/lib/server';
export const dynamic = 'force-dynamic';
export async function GET() { try {
    const { token } = await session();
    const { rows } = await getPool().query('select m.order_id,m.status,m.current_period_end,m.cancel_at_period_end,o.contact_id,o.snapshot->>\'title\' title from private.growth_memberships m join private.growth_orders o on o.id=m.order_id where m.user_id=$1 order by m.updated_at desc limit 100', [token]);
    return Response.json({ memberships: rows }, { headers: { 'Cache-Control': 'no-store' } });
}
catch (e) {
    return failure(e);
} }
export async function POST(request: NextRequest) { try {
    sameOrigin(request);
    const { token } = await session(), input = await body(request);
    if (input.action !== 'cancel')
        throw new ApiError('Invalid membership operation.');
    const m = (await getPool().query('select m.*,o.stripe_account_id from private.growth_memberships m join private.growth_orders o on o.id=m.order_id where m.order_id=$1 and m.user_id=$2', [uuid(input.orderId), token])).rows[0];
    if (!m)
        throw new ApiError('Membership not found.', 404);
    const stripe = await stripeClient();
    const sub = await stripe.subscriptions.update(m.stripe_subscription_id, { cancel_at_period_end: true }, { stripeAccount: m.stripe_account_id, idempotencyKey: 'growth-cancel:' + m.order_id });
    await getPool().query('update private.growth_memberships set status=$2,cancel_at_period_end=$3,updated_at=now() where order_id=$1', [m.order_id, sub.status,sub.cancel_at_period_end]);
    return Response.json({ cancelAtPeriodEnd: true });
}
catch (e) {
    return failure(e);
} }
