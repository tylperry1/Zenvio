import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { ApiError, body, failure, sameOrigin, session, string, uuid } from "@/lib/server";
import { allowRequest } from "@/lib/booking-protection";
export const dynamic = "force-dynamic";
export async function GET() { try {
    const { token } = await session();
    const { rows } = await getPool().query("select id,event_id,contact_id,preferred_from,preferred_until,state,email_opt_in,created_at from private.appointment_waitlists where user_id=$1 order by created_at desc limit 100", [token]);
    return Response.json({ entries: rows, offersEnabled: process.env.WAITLIST_OFFERS_ENABLED === 'true' }, { headers: { 'Cache-Control': 'no-store' } });
}
catch (e) {
    return failure(e);
} }
export async function POST(request: NextRequest) {
    try {
        sameOrigin(request);
        const { token } = await session(), input = await body(request);
        if (!await allowRequest('waitlist-mutation', token, 30, 3600))
            throw new ApiError('Waitlist update limit reached.', 429);
        const db = await getPool().connect();
        try {
            await db.query('begin');
            if (input.action === 'cancel') {
                const id = uuid(input.id), row = (await db.query("update private.appointment_waitlists set state='cancelled' where id=$1 and user_id=$2 and state in ('waiting','offered') returning id", [id, token])).rows[0];
                if (!row)
                    throw new ApiError('Waitlist entry not found.', 404);
                await db.query("update private.waitlist_offers set state='cancelled' where waitlist_id=$1 and state='offered'", [id]);
                await db.query("update private.delivery_jobs set status='cancelled',payload_ciphertext=null where waitlist_offer_id in(select id from private.waitlist_offers where waitlist_id=$1) and status='queued'", [id]);
                await db.query('commit');
                return Response.json({ ok: true });
            }
            if (input.action !== 'join' || input.emailOptIn !== true)
                throw new ApiError('Explicit appointment-offer email consent is required.', 409);
            const eventId = uuid(input.eventId), contactId = uuid(input.contactId), evidence = string(input.consentEvidence, 'consent evidence', 1000, 8), from = string(input.preferredFrom, 'preferred start', 40), until = string(input.preferredUntil, 'preferred end', 40);
            if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(until)) || Date.parse(from) >= Date.parse(until) || Date.parse(until) <= Date.now() || Date.parse(until) > Date.now() + 91 * 86400000)
                throw new ApiError('Choose a future waitlist window within 90 days.');
            const valid = (await db.query("select 1 from public.event_types e join public.contacts c on c.user_id=e.user_id where e.id=$1 and c.id=$2 and e.user_id=$3 and e.active and e.deleted_at is null and e.payment_mode='free'", [eventId, contactId, token])).rows[0];
            if (!valid)
                throw new ApiError('An owned client and active free appointment type are required.', 404);
            await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", ['waitlist:' + token]);
            const count = (await db.query("select count(*)::int n from private.appointment_waitlists where user_id=$1 and state in ('waiting','offered')", [token])).rows[0].n;
            if (count >= 100)
                throw new ApiError('This workspace has reached its active waitlist limit.', 429);
            const r = (await db.query("insert into private.appointment_waitlists(user_id,event_id,contact_id,preferred_from,preferred_until,email_opt_in,consent_evidence) values($1,$2,$3,$4,$5,true,$6) on conflict(user_id,event_id,contact_id) where state in ('waiting','offered') do update set preferred_from=$4,preferred_until=$5,email_opt_in=true,consent_evidence=$6,state='waiting' returning id,state", [token, eventId, contactId, from, until, evidence])).rows[0];
            await db.query("update private.waitlist_offers set state='cancelled' where waitlist_id=$1 and state='offered'",[r.id]);
            await db.query('commit');
            return Response.json({ entry: r }, { status: 201 });
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
