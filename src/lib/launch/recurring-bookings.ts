import { createHash } from "node:crypto";
import { getPool } from "../db";
import { ApiError } from "../server";
import { intakeAnswers } from "../intake";
import { filterGoogleSlots } from "../google-calendar";
import { filterMicrosoftSlots } from "../microsoft-calendar";
import { scheduleBooking } from "../lifecycle";
import { recurrenceStarts } from "../recurrence.mjs";
export async function createRecurringBookings(userId: string, input: {
    eventId: string;
    startsAt: string;
    timezone: string;
    count: number;
    interval: string;
    reference: string;
    name: string;
    email: string;
    phone: string;
    notes: string;
    answers: unknown;
}) {
    const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex"), pool = getPool();
    const prior = (await pool.query("select id,digest,booking_ids,starts_at from private.booking_series where user_id=$1 and reference=$2", [userId, input.reference])).rows[0];
    if (prior) {
        if (prior.digest !== digest)
            throw new ApiError("This series reference was used for different appointments.", 409);
        return { seriesId: prior.id, bookingIds: prior.booking_ids, startsAt: prior.starts_at, duplicate: true };
    }
    const before = (await pool.query("select e.*,p.slug host_slug,p.timezone from public.event_types e join public.profiles p on p.id=e.user_id where e.id=$1 and e.user_id=$2 and e.active and e.deleted_at is null", [input.eventId, userId])).rows[0];
    if (!before)
        throw new ApiError("Appointment type not found.", 404);
    let verifiedStarts: string[];
    try {
        verifiedStarts = recurrenceStarts(input.startsAt, input.timezone, input.count, input.interval);
    }
    catch (e) {
        throw new ApiError(e instanceof Error ? e.message : "Invalid recurrence.");
    }
    const google = await filterGoogleSlots(before.host_slug, before.slug, verifiedStarts), available = await filterMicrosoftSlots(before.host_slug, before.slug, google);
    if (available.length !== verifiedStarts.length)
        throw new ApiError("At least one recurring appointment conflicts with a connected calendar.", 409);
    const db = await pool.connect();
    try {
        await db.query("begin");
        await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", ["booking-series:" + userId]);
        const existing = (await db.query("select id,digest,booking_ids,starts_at from private.booking_series where user_id=$1 and reference=$2", [userId, input.reference])).rows[0];
        if (existing) {
            if (existing.digest !== digest)
                throw new ApiError("This series reference was used for different appointments.", 409);
            await db.query("commit");
            return { seriesId: existing.id, bookingIds: existing.booking_ids, startsAt: existing.starts_at, duplicate: true };
        }
        const e = (await db.query("select e.*,p.slug host_slug,p.timezone from public.event_types e join public.profiles p on p.id=e.user_id where e.id=$1 and e.user_id=$2 and e.active and e.deleted_at is null for share of e,p", [input.eventId, userId])).rows[0];
        if (!e)
            throw new ApiError("Appointment type not found.", 404);
        if (e.payment_mode !== "free")
            throw new ApiError("Recurring paid appointments require a verified series-payment flow. No charges were made.", 409);
        if (input.timezone !== e.timezone)
            throw new ApiError("Use the host's configured timezone for the recurring series.", 409);
        let starts: string[];
        try {
            starts = recurrenceStarts(input.startsAt, input.timezone, input.count, input.interval);
        }
        catch (e) {
            throw new ApiError(e instanceof Error ? e.message : "Invalid recurrence.");
        }
        if (e.slug !== before.slug || e.host_slug !== before.host_slug || e.duration !== before.duration || e.buffer !== before.buffer || JSON.stringify(e.intake_questions) !== JSON.stringify(before.intake_questions))
            throw new ApiError("The appointment type changed. Review the recurring series and try again.", 409);
        const answers = intakeAnswers(e.intake_questions || [], input.answers), ids: string[] = [];
        for (const start of starts) {
            const result = (await db.query("select public.reserve_booking_intake($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result", [e.host_slug, e.slug, start, input.name, input.email, input.notes, input.phone, "", "", JSON.stringify(answers)])).rows[0].result;
            ids.push(result.id);
            await scheduleBooking(db, result.id);
        }
        const series = (await db.query("insert into private.booking_series(user_id,event_id,reference,digest,timezone,recurrence,starts_at,booking_ids) values($1,$2,$3,$4,$5,$6,$7,$8) returning id", [userId, input.eventId, input.reference, digest, input.timezone, input.interval, JSON.stringify(starts), ids])).rows[0];
        await db.query("commit");
        return { seriesId: series.id, bookingIds: ids, startsAt: starts, duplicate: false };
    }
    catch (e) {
        await db.query("rollback");
        if ((e as any).code === '23P01' || String((e as any).message).includes('slot_unavailable'))
            throw new ApiError("A recurring time is unavailable. No appointments in this series were created.", 409);
        if (String((e as any).message).includes('rate_limit'))
            throw new ApiError("Booking rate limit reached. No series was created.", 429);
        throw e;
    }
    finally {
        db.release();
    }
}
