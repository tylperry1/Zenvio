import { NextRequest, after } from 'next/server';
import { getPool } from '@/lib/db';
import { ApiError, body, failure, integer, sameOrigin, session, string, uuid } from '@/lib/server';
import { createClass, publicClass, cancelClass } from '@/lib/launch/classes';
import { afterBookingChange } from '@/lib/booking-actions';
import { allowRequest } from '@/lib/booking-protection';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) { try {
    const roster=request.nextUrl.searchParams.get('roster');
        if(roster){const {token}=await session();const rows=await getPool().query('select r.id,r.name,r.email,r.state,r.created_at from private.class_registrations r join private.class_sessions s on s.id=r.session_id where s.id=$1 and s.user_id=$2 order by r.created_at limit 500',[uuid(roster),token]);return Response.json({registrations:rows.rows},{headers:{'Cache-Control':'no-store'}});}
        const id = request.nextUrl.searchParams.get('id');
    if (id)
        return Response.json({ session: await publicClass(uuid(id)) }, { headers: { 'Cache-Control': 'no-store' } });
    const { token } = await session();
    const { rows } = await getPool().query("select s.*,(select count(*)::int from private.class_registrations r where r.session_id=s.id and r.state='confirmed') registered from private.class_sessions s where user_id=$1 order by starts_at desc limit 100", [token]);
    return Response.json({ sessions: rows }, { headers: { 'Cache-Control': 'no-store' } });
}
catch (e) {
    return failure(e);
} }
export async function POST(request: NextRequest) { try {
    sameOrigin(request);
    const { token } = await session(), input = await body(request);
    if (!await allowRequest('class-admin', token, 30, 3600))
        throw new ApiError('Class update limit reached.', 429);
    if (input.action === 'cancel') {
        const result = await cancelClass(token, uuid(input.id));
        after(() => afterBookingChange(token));
        return Response.json(result);
    }
    if (input.action !== 'create')
        throw new ApiError('Invalid class operation.');
    const start = string(input.startsAt, 'start', 40), unit = string(input.creditUnit || 'SERVICE', 'credit unit', 24);
    if (!Number.isFinite(Date.parse(start)) || !/^[A-Z_]{2,24}$/.test(unit))
        throw new ApiError('Invalid class time or credit unit.');
    const row = await createClass(token, { eventId: uuid(input.eventId), title: string(input.title, 'class title', 150, 2), description: string(input.description || '', 'description', 2000, 0), startsAt: new Date(start).toISOString(), capacity: integer(input.capacity, 'capacity', 1, 500), published: input.published === true, creditCost: integer(input.creditCost ?? 0, 'credit cost', 0, 1000000), creditUnit: unit });
    after(() => afterBookingChange(token));
    return Response.json({ session: row }, { status: 201 });
}
catch (e) {
    return failure(e);
} }
