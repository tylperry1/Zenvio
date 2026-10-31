import { NextRequest } from 'next/server';
import { ApiError, body, email, failure, sameOrigin, session, string, uuid } from '@/lib/server';
import { registerClass, cancelClassRegistration } from '@/lib/launch/classes';
import { protectBooking, allowRequest, clientIp } from '@/lib/booking-protection';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) { try {
    sameOrigin(request);
    const input = await body(request);
    if (input.action === 'cancel') {
        if (!await allowRequest('class-cancel', clientIp(request), 20, 60))
            throw new ApiError('Too many cancellation requests.', 429);
        const token = string(input.token, 'cancellation reference', 64, 64);
        if (!/^[a-f0-9]{64}$/.test(token))
            throw new ApiError('Invalid cancellation reference.');
        return Response.json(await cancelClassRegistration(token));
    }
    if (input.action !== 'enroll')
        throw new ApiError('Invalid registration operation.');
    let hostUserId: string | undefined;
    if (input.applyCredits === true) {
        hostUserId = (await session()).token;
        if (!await allowRequest('class-credit-enrollment', hostUserId, 30, 3600))
            throw new ApiError('Registration limit reached.', 429);
    }
    else
        await protectBooking(request, input.captcha);
    const reference = uuid(input.idempotencyKey);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(reference))
        throw new ApiError('Use a random UUIDv4 registration reference.');
    const result = await registerClass(uuid(input.sessionId), { name: string(input.name, 'name', 100, 2), email: email(input.email), reference, hostUserId, ...(input.contactId ? { contactId: uuid(input.contactId) } : {}), ...(input.balanceAccountId ? { balanceAccountId: uuid(input.balanceAccountId) } : {}) });
    return Response.json(result, { status: result.duplicate ? 200 : 201, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
catch (e) {
    return failure(e);
} }
