import { createHash, randomBytes } from "node:crypto";
import { getPool } from "../db";
import { ApiError } from "../server";
import { filterGoogleSlots } from "../google-calendar";
import { filterMicrosoftSlots } from "../microsoft-calendar";
import { appOrigin, queueDelivery, scheduleBooking } from "../lifecycle";
import { intakeAnswers } from "../intake";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function materializeWaitlistOffers(limit = 5) {
    if (process.env.WAITLIST_OFFERS_ENABLED !== "true")
        return { offered: 0, enabled: false };
    const pool = getPool();
    const expired = await pool.connect();
    try {
        await expired.query("begin");
        const rows = (await expired.query("update private.waitlist_offers set state='expired' where state='offered' and expires_at<=now() returning waitlist_id")).rows;
        for (const r of rows)
            await expired.query("update private.appointment_waitlists set state='waiting' where id=$1 and state='offered'", [r.waitlist_id]);
        await expired.query("commit");
    }
    catch (e) {
        await expired.query("rollback");
        throw e;
    }
    finally {
        expired.release();
    }
    let offered = 0;
    const events = (await pool.query(`select s.*,e.slug event_slug,e.title,p.slug host_slug from private.waitlist_slot_events s
  join public.event_types e on e.id=s.event_id join public.profiles p on p.id=s.user_id
  where s.processed_at is null and s.starts_at>now()+interval '2 hours' and e.active and e.deleted_at is null and e.payment_mode='free'
  order by s.created_at limit $1`, [Math.min(20, limit)])).rows;
    for (const event of events) {
        const start = new Date(event.starts_at).toISOString();
        const available = await filterMicrosoftSlots(event.host_slug, event.event_slug, await filterGoogleSlots(event.host_slug, event.event_slug, [start]));
        if (!available.length) {
            await pool.query("update private.waitlist_slot_events set processed_at=now() where id=$1", [event.id]);
            continue;
        }
        const db = await pool.connect();
        try {
            await db.query("begin");
            const claimed = (await db.query("select id from private.waitlist_slot_events where id=$1 and processed_at is null for update skip locked", [event.id])).rows[0];
            if (!claimed) {
                await db.query("rollback");
                continue;
            }
            const entry = (await db.query(`select w.*,c.name,c.email from private.appointment_waitlists w join public.contacts c on c.id=w.contact_id and c.user_id=w.user_id
    where w.event_id=$1 and w.user_id=$2 and w.state='waiting' and w.email_opt_in and w.preferred_from<=$3 and w.preferred_until>=$3
    order by w.created_at,w.id limit 1 for update of w skip locked`, [event.event_id, event.user_id, start])).rows[0];
            if (entry) {
                const token = randomBytes(32).toString("hex"), expires = new Date(Math.min(Date.now() + 30 * 60000, Date.parse(start) - 2 * 3600000));
                const offer = (await db.query("insert into private.waitlist_offers(waitlist_id,slot_event_id,token_hash,expires_at,recipient_email,recipient_name) values($1,$2,$3,$4,$5,$6) returning id", [entry.id, event.id, hash(token), expires,entry.email,entry.name])).rows[0];
                const key = "waitlist-offer:" + offer.id;
                await queueDelivery(db, { user: event.user_id, kind: "waitlist_offer", key, to: entry.email, subject: "An appointment time is available: " + event.title, text: `${entry.name},\n\nA requested appointment time is available at ${start}.\nReview this offer before ${expires.toISOString()}:\n${appOrigin()}/book/${event.host_slug}/${event.event_slug}#waitlist_offer=${token}\n\nThis is an invitation to book, not an exclusive reservation. The first completed booking secures the time.`, expires });
                await db.query("update private.delivery_jobs set waitlist_offer_id=$2 where dedupe_key=$1", [key, offer.id]);
                await db.query("update private.appointment_waitlists set state='offered' where id=$1", [entry.id]);
                offered++;
            }
            await db.query("update private.waitlist_slot_events set processed_at=now() where id=$1", [event.id]);
            await db.query("commit");
        }
        catch (e) {
            await db.query("rollback");
            throw e;
        }
        finally {
            db.release();
        }
    }
    return { offered, enabled: true };
}
export async function readWaitlistOffer(token: string) {
    const row = (await getPool().query(`select o.id,o.state,o.expires_at,s.starts_at,e.title,e.slug event_slug,p.slug host_slug from private.waitlist_offers o
  join private.appointment_waitlists w on w.id=o.waitlist_id join private.waitlist_slot_events s on s.id=o.slot_event_id
  join public.event_types e on e.id=w.event_id join public.profiles p on p.id=w.user_id where o.token_hash=$1 and w.state<>'cancelled'`, [hash(token)])).rows[0];
    if (!row || row.state !== "offered" || new Date(row.expires_at).getTime() <= Date.now())
        throw new ApiError("This appointment offer has expired or is unavailable.", 410);
    return { id: row.id, title: row.title, startsAt: row.starts_at, expiresAt: row.expires_at, bookingUrl: `/book/${row.host_slug}/${row.event_slug}`, reservationPolicy: "first_confirmed" };
}
export async function acceptWaitlistOffer(token: string, answers: unknown) {
    if (process.env.WAITLIST_OFFERS_ENABLED !== "true")
        throw new ApiError("Waitlist offers are not active.", 503);
    const pool = getPool(), before = (await pool.query(`select o.id,o.state,o.booking_id,s.starts_at,e.slug event_slug,p.slug host_slug from private.waitlist_offers o join private.appointment_waitlists w on w.id=o.waitlist_id join private.waitlist_slot_events s on s.id=o.slot_event_id join public.event_types e on e.id=w.event_id join public.profiles p on p.id=w.user_id where o.token_hash=$1`, [hash(token)])).rows[0];
    if (!before)
        throw new ApiError("Appointment offer not found.", 404);
    if (before.state === 'booked')
        return { bookingId: before.booking_id, duplicate: true };
    const start = new Date(before.starts_at).toISOString();
    if (!(await filterMicrosoftSlots(before.host_slug, before.event_slug, await filterGoogleSlots(before.host_slug, before.event_slug, [start]))).length)
        throw new ApiError("This time is no longer available.", 409);
    const db = await pool.connect();
    try {
        await db.query("begin");
        const row = (await db.query(`select o.*,w.user_id,w.event_id,w.state waitlist_state,c.name,c.email,e.slug event_slug,e.intake_questions,e.payment_mode,p.slug host_slug,s.starts_at
   from private.waitlist_offers o join private.appointment_waitlists w on w.id=o.waitlist_id join public.contacts c on c.id=w.contact_id and c.user_id=w.user_id
   join public.event_types e on e.id=w.event_id join public.profiles p on p.id=w.user_id join private.waitlist_slot_events s on s.id=o.slot_event_id
   where o.token_hash=$1 for update of o,w`, [hash(token)])).rows[0];
        // Idempotent repeated acceptance never creates a second appointment or exposes a management token.
        if (row?.state === 'booked') {
            await db.query('commit');
            return { bookingId: row.booking_id, duplicate: true };
        }
        if (!row || row.state !== "offered" || row.waitlist_state !== "offered" || new Date(row.expires_at).getTime() <= Date.now())
            throw new ApiError("This appointment offer has expired or is unavailable.", 410);
        if(!row.recipient_email||row.recipient_email!==row.email)throw new ApiError("Client details changed. Request a new appointment offer.",409);
        if (row.payment_mode !== "free" || new Date(row.starts_at).getTime() !== Date.parse(start))
            throw new ApiError("Offer changed; review the current booking page.", 409);
        const result = (await db.query("select public.reserve_booking_intake($1,$2,$3,$4,$5,'','','','',$6) result", [row.host_slug, row.event_slug, start, row.recipient_name, row.recipient_email, JSON.stringify(intakeAnswers(row.intake_questions || [], answers))])).rows[0].result;
        await scheduleBooking(db, result.id);
        await db.query("update private.waitlist_offers set state='booked',booking_id=$2 where id=$1", [row.id, result.id]);
        await db.query("update private.appointment_waitlists set state='booked' where id=$1", [row.waitlist_id]);
        await db.query("commit");
        return { bookingId: result.id, duplicate: false };
    }
    catch (e) {
        await db.query("rollback");
        if ((e as any).code === '23P01' || String((e as any).message).includes('slot_unavailable'))
            throw new ApiError("This time was just booked. No duplicate booking was created.", 409);
        throw e;
    }
    finally {
        db.release();
    }
}
