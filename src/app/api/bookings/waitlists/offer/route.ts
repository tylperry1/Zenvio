import { NextRequest } from "next/server";
import { ApiError, body, failure, sameOrigin, string } from "@/lib/server";
import { allowRequest, clientIp } from "@/lib/booking-protection";
import { readWaitlistOffer, acceptWaitlistOffer } from "@/lib/launch/waitlists";
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) { try {
    sameOrigin(request);
    if (!await allowRequest('waitlist-offer', clientIp(request), 20, 60))
        throw new ApiError('Too many offer requests.', 429);
    const input = await body(request), token = string(input.token, 'offer token', 64, 64);
    if (!/^[a-f0-9]{64}$/.test(token))
        throw new ApiError('Invalid appointment offer.', 404);
    if (!['read', 'accept'].includes(String(input.action)))
        throw new ApiError('Invalid offer action.');
    return Response.json(input.action === 'read' ? await readWaitlistOffer(token) : await acceptWaitlistOffer(token, input.answers), { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
catch (e) {
    return failure(e);
} }
