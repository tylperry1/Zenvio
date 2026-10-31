import { NextRequest } from 'next/server';
import { body, email, failure, sameOrigin, string, uuid } from '@/lib/server';
import { protectBooking } from '@/lib/booking-protection';
import { createGrowthCheckout } from '@/lib/launch/customer-commerce';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) { try {
    sameOrigin(request);
    const input = await body(request);
    await protectBooking(request, input.captcha);
    return Response.json(await createGrowthCheckout({ offerId: uuid(input.offerId), reference: uuid(input.idempotencyKey), name: string(input.name, 'name', 100, 2), email: email(input.email), recipientEmail: email(input.recipientEmail || input.email), coupon: string(input.coupon || '', 'coupon', 40, 0).toUpperCase() }));
}
catch (e) {
    return failure(e);
} }
