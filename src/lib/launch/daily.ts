import { createHash } from "node:crypto";
import { getPool } from "../db";
import { integrationValue } from "../platform-settings";
import { ApiError } from "../server";
import { reserveUsage, uncertainUsage } from "./provider-policy";
export async function dailyConfigured() { return process.env.DAILY_VIDEO_ENABLED === "true" && Boolean(await integrationValue("DAILY_API_KEY")); }
async function daily(path: string, body?: unknown) {
    const key = await integrationValue("DAILY_API_KEY");
    if (!key || !await dailyConfigured())
        throw new ApiError("Video meetings are not active.", 503);
    const r = await fetch("https://api.daily.co/v1" + path, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
    if (!r.ok)
        throw new ApiError("Video provider request could not be confirmed.", 503);
    return r.json();
}
export function dailyWindow(startsAt: string, endsAt: string, now = Date.now()) {
    const start = Date.parse(startsAt), end = Date.parse(endsAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 8 * 3600000)
        throw new ApiError("Video requires an appointment lasting at most eight hours.", 409);
    if (now < start - 15 * 60000 || now >= end + 15 * 60000)
        throw new ApiError("Video access opens 15 minutes before the appointment and expires 15 minutes after it.", 409);
    return { nbf: Math.floor((start - 15 * 60000) / 1000), exp: Math.floor((end + 15 * 60000) / 1000) };
}
export async function dailyAccess(bookingId: string, scope: {
    userId: string;
} | {
    guestToken: string;
}) {
    if (!await dailyConfigured())
        throw new ApiError("Video meetings are not active.", 503);
    const pool = getPool(), host = "userId" in scope;
    const initial = (await pool.query(`select id,user_id,starts_at,ends_at,status from public.bookings where id=$1 and ${host ? "user_id=$2" : "cancel_token::text=$2"}`, [bookingId, host ? scope.userId : scope.guestToken])).rows[0];
    if (!initial || initial.status !== "confirmed")
        throw new ApiError("Appointment not found or cancelled.", 404);
    const initialWindow = dailyWindow(initial.starts_at, initial.ends_at);
    const initialName = "z-" + createHash("sha256").update(bookingId + ":" + new Date(initial.starts_at).toISOString() + ":" + new Date(initial.ends_at).toISOString()).digest("hex").slice(0, 40);
    const existing = (await pool.query("select room_name from private.video_rooms where booking_id=$1", [bookingId])).rows[0];
    let reservation: string | undefined;
    let rateMicros: number | undefined;
    if (existing?.room_name !== initialName) {
        rateMicros = Number(process.env.DAILY_PARTICIPANT_MINUTE_MICROS || 0);
        if (!Number.isSafeInteger(rateMicros) || rateMicros <= 0) throw new ApiError("Video pricing is not configured.",503);
        reservation = await reserveUsage({ userId: initial.user_id, provider: "daily", micros: Math.ceil((initialWindow.exp - initialWindow.nbf) / 60) * 2 * rateMicros, platformCap: Number(process.env.DAILY_MONTHLY_CAP_MICROS || 0), workspaceCap: Number(process.env.DAILY_WORKSPACE_CAP_MICROS || 0) });
    }
    const db = await pool.connect();
    try {
        await db.query("begin");
        await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", ["daily:" + bookingId]);
        const booking = (await db.query(`select id,user_id,starts_at,ends_at,guest_name,status from public.bookings where id=$1 and ${host ? "user_id=$2" : "cancel_token::text=$2"} for update`, [bookingId, host ? scope.userId : scope.guestToken])).rows[0];
        if (!booking || booking.status !== "confirmed")
            throw new ApiError("Appointment not found or cancelled.", 404);
        const window = dailyWindow(booking.starts_at, booking.ends_at);
        if (new Date(booking.starts_at).getTime() !== new Date(initial.starts_at).getTime() || new Date(booking.ends_at).getTime() !== new Date(initial.ends_at).getTime())
            throw new ApiError("Appointment changed; request fresh meeting access.", 409);
        const name = "z-" + createHash("sha256").update(bookingId + ":" + new Date(booking.starts_at).toISOString() + ":" + new Date(booking.ends_at).toISOString()).digest("hex").slice(0, 40);
        let room = (await db.query("select * from private.video_rooms where booking_id=$1", [bookingId])).rows[0];
        if (!room || room.room_name !== name) {
            // Reserve full possible participant-minutes. Kept reserved until reconciled against provider usage.
            if (!reservation)
                throw new ApiError("Video room changed; request fresh meeting access.", 409);
            let created: any;
            try {
                created = await daily("/rooms", { name, privacy: "private", properties: { ...window, max_participants: 2, eject_at_room_exp: true, enforce_unique_user_ids: true, enable_prejoin_ui: true, enable_knocking: false, enable_recording: false } });
            }
            catch {
                created = await daily("/rooms/" + name);
            }
            if (created.name !== name || created.privacy !== "private" || !/^https:\/\/[^/]+\.daily\.co\//.test(created.url || "") || Number(created.config?.exp) !== window.exp)
                throw new ApiError("Video room privacy or expiry could not be verified.", 503);
            room = (await db.query(`insert into private.video_rooms(booking_id,user_id,room_name,join_url,starts_at,expires_at,usage_id) values($1,$2,$3,$4,$5,to_timestamp($6),$7)
        on conflict(booking_id) do update set room_name=$3,join_url=$4,starts_at=$5,expires_at=to_timestamp($6),usage_id=$7 returning *`, [bookingId, booking.user_id, name, created.url, booking.starts_at, window.exp, reservation])).rows[0];
            await db.query("insert into private.daily_room_usage(room_name,booking_id,user_id,usage_id,starts_at,expires_at,rate_micros) values($1,$2,$3,$4,$5,$6,$7) on conflict(room_name) do nothing",[room.room_name,bookingId,booking.user_id,reservation,booking.starts_at,room.expires_at,rateMicros]);
        }
        else if (reservation) {
            await db.query("update private.provider_usage_reservations set state='released' where id=$1 and state='reserved'", [reservation]);
            reservation = undefined;
        }
        const exp = Math.min(window.exp, Math.floor(Date.now() / 1000) + 15 * 60);
        const access = await daily("/meeting-tokens", { properties: { room_name: room.room_name, exp, nbf: Math.floor(Date.now() / 1000) - 5, is_owner: host, user_id: (host ? "host:" : "guest:") + bookingId, user_name: host ? "Host" : String(booking.guest_name).slice(0, 80), eject_at_token_exp: true } });
        if (typeof access.token !== "string")
            throw new ApiError("Meeting access could not be created.", 503);
        await db.query("commit");
        return { appointmentId: bookingId, provider: "daily", joinUrl: room.join_url, token: access.token, expiresAt: new Date(exp * 1000).toISOString() };
    }
    catch (e) {
        await db.query("rollback");
        if (reservation)
            await uncertainUsage(reservation);
        throw e;
    }
    finally {
        db.release();
    }
}
