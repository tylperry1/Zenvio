import { NextRequest } from 'next/server';
import { ApiError, body, email, failure, sameOrigin, string } from '@/lib/server';
import { allowRequest, clientIp } from '@/lib/booking-protection';
import { redeemGiftCard } from '@/lib/launch/customer-commerce';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) { try {
    sameOrigin(request);
    if (!await allowRequest('gift-card-redemption', clientIp(request), 10, 3600))
        throw new ApiError('Gift-card redemption limit reached.', 429);
    const input = await body(request), code = string(input.code, 'gift-card code', 48, 48).toLowerCase();
    if (!/^[a-f0-9]{48}$/.test(code))
        throw new ApiError('Invalid gift-card code.');
    return Response.json(await redeemGiftCard({ code, name: string(input.name, 'name', 100, 2), email: email(input.email) }), { headers: { 'Cache-Control': 'no-store' } });
}
catch (e) {
    return failure(e);
} }
