import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { ApiError, body, failure, sameOrigin, session, string, uuid } from "@/lib/server";
export const dynamic = 'force-dynamic';
export async function GET() { try {
    const { token } = await session();
    const { rows } = await getPool().query("select id,guest_name,starts_at,ends_at,attendance_status from public.bookings where user_id=$1 and status='confirmed' and ends_at<=now() order by ends_at desc limit 100", [token]);
    return Response.json({ appointments: rows }, { headers: { 'Cache-Control': 'no-store' } });
}
catch (e) {
    return failure(e);
} }
export async function POST(request: NextRequest) {
    try {
        sameOrigin(request);
        const { token } = await session(), input = await body(request), reason = string(input.reason, 'reason', 500, 8), db = await getPool().connect();
        try {
            await db.query('begin');
            if (input.action === 'policy') {
                const id = uuid(input.eventId), policy = string(input.policy ?? '', 'no-show policy', 2000, 0);
                const r = await db.query('update public.event_types set no_show_policy=$3 where id=$1 and user_id=$2 and deleted_at is null returning id', [id, token, policy]);
                if (!r.rowCount)
                    throw new ApiError('Appointment type not found.', 404);
                await db.query("insert into private.operation_log(actor_id,action,details) values($1,'no_show_policy_updated',$2)", [token, JSON.stringify({ eventId: id, policy, reason })]);
            }
            else {
                if (input.action !== 'attendance' || !['unknown', 'attended', 'no_show'].includes(String(input.status)))
                    throw new ApiError('Invalid attendance state.');
                const id = uuid(input.bookingId), r = await db.query("update public.bookings set attendance_status=$3 where id=$1 and user_id=$2 and status='confirmed' and ends_at<=now() returning id", [id, token, input.status]);
                if (!r.rowCount)
                    throw new ApiError('Only an ended appointment in your workspace can be marked.', 409);
                await db.query("insert into private.booking_activity(booking_id,actor_id,action,details) values($1,$2,'attendance_recorded',$3)", [id, token, JSON.stringify({ status: input.status, reason })]);
            }
            await db.query('commit');
            return Response.json({ ok: true, automaticFeesEnabled: false });
        }
        catch (e) {
            await db.query('rollback');
            throw e;
        }
        finally {
            db.release();
        }
    }
    catch (e) {
        return failure(e);
    }
}
