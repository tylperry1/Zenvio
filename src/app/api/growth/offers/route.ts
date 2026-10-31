import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { ApiError, body, failure, integer, sameOrigin, session, string, uuid } from '@/lib/server';
import { growthCheckoutReady } from '@/lib/launch/customer-commerce';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) { try {
    const host = request.nextUrl.searchParams.get('host');
    if (host) {
        const { rows } = await getPool().query('select o.id,o.kind,o.title,o.description,o.price_cents,o.credit_units,o.unit from private.growth_offers o join public.profiles p on p.id=o.user_id where p.slug=$1 and o.active order by o.created_at desc limit 100', [string(host, 'host', 100)]);
        return Response.json({ offers: rows, checkoutEnabled: await growthCheckoutReady() }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const { token } = await session();
    const [offers, coupons, orders] = await Promise.all([getPool().query('select * from private.growth_offers where user_id=$1 order by created_at desc limit 100', [token]), getPool().query('select id,code,percent_off,maximum_uses,expires_at,active from private.growth_coupons where user_id=$1 order by created_at desc limit 100', [token]), getPool().query('select id,offer_id,state,amount_cents,paid_at,created_at from private.growth_orders where user_id=$1 order by created_at desc limit 100', [token])]);
    return Response.json({ offers: offers.rows, coupons: coupons.rows, orders: orders.rows, checkoutEnabled: await growthCheckoutReady() }, { headers: { 'Cache-Control': 'no-store' } });
}
catch (e) {
    return failure(e);
} }
export async function POST(request: NextRequest) {
    try {
        sameOrigin(request);
        const { token } = await session(), input = await body(request);
        if (input.action === 'publish') {
            if (typeof input.active !== 'boolean')
                throw new ApiError('Invalid publication state.');
            const r = await getPool().query('update private.growth_offers set active=$3 where id=$1 and user_id=$2 returning id', [uuid(input.id), token, input.active]);
            if (!r.rowCount)
                throw new ApiError('Offer not found.', 404);
            return Response.json({ ok: true });
        }
        if (input.action === 'coupon') {
            const code = string(input.code, 'coupon code', 40, 4).toUpperCase(), expires = string(input.expiresAt, 'expiry', 40);
            if (!/^[A-Z0-9_-]+$/.test(code) || !Number.isFinite(Date.parse(expires)) || Date.parse(expires) <= Date.now())
                throw new ApiError('Invalid coupon code or expiry.');
            const r = await getPool().query('insert into private.growth_coupons(user_id,code,percent_off,maximum_uses,expires_at) values($1,$2,$3,$4,$5) returning id', [token, code, integer(input.percentOff, 'discount percentage', 1, 90), integer(input.maximumUses, 'redemptions', 1, 100000), expires]);
            return Response.json({ id: r.rows[0].id }, { status: 201 });
        }
        if (input.action !== 'create' || !['package', 'membership', 'gift_card'].includes(String(input.kind)))
            throw new ApiError('Invalid customer offer.');
        const price = integer(input.priceCents, 'price', 50, 10000000), credits = integer(input.creditUnits, 'credits', 1, 100000000), unit = string(input.unit, 'unit', 24);
        if (!/^[A-Z_]{2,24}$/.test(unit))
            throw new ApiError('Invalid credit unit.');
        if (input.kind === 'gift_card' && (unit !== 'USD' || credits !== price))
            throw new ApiError('Gift cards use USD cents at their face value.');
        const r = await getPool().query('insert into private.growth_offers(user_id,kind,title,description,price_cents,credit_units,unit) values($1,$2,$3,$4,$5,$6,$7) returning id', [token, input.kind, string(input.title, 'offer title', 150, 2), string(input.description || '', 'description', 2000, 0), price, credits, unit]);
        return Response.json({ id: r.rows[0].id }, { status: 201 });
    }
    catch (e) {
        return failure(e);
    }
}
