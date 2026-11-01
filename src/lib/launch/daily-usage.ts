import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError } from "../server";

/** Daily signs timestamp + '.' + JSON.stringify(event) using a base64-decoded HMAC key. */
export function dailyWebhookValid(raw: string, timestamp: string, signature: string, secret: string, now=Date.now()) {
    try {
        if (!/^\d{10,13}$/.test(timestamp) || !/^[A-Za-z0-9+/]{43}=$/.test(signature) || !/^[A-Za-z0-9+/]+={0,2}$/.test(secret)) return false;
        const value=Number(timestamp), seconds=value>1e12?value/1000:value;
        if (Math.abs(now/1000-seconds)>900) return false;
        const key=Buffer.from(secret,"base64");
        if (key.length<32 || key.length>128) return false;
        const canonical=JSON.stringify(JSON.parse(raw));
        const expected=createHmac("sha256",key).update(timestamp+"."+canonical).digest();
        const supplied=Buffer.from(signature,"base64");
        return expected.length===supplied.length && timingSafeEqual(expected,supplied);
    } catch { return false; }
}
export function dailyParticipant(payload: unknown) {
    const p=payload as Record<string,unknown>;
    if (!p || typeof p!=="object" || typeof p.session_id!=="string" || !/^[A-Za-z0-9_-]{1,128}$/.test(p.session_id) ||
        typeof p.joined_at!=="number" || !Number.isFinite(p.joined_at) || p.joined_at<0 || p.joined_at>8640000000000 ||
        typeof p.duration!=="number" || !Number.isFinite(p.duration) || p.duration<0 || p.duration>86400) throw new ApiError("Invalid video participant usage.");
    return {sessionId:p.session_id, joinedAt:new Date(p.joined_at*1000), durationMs:Math.ceil(p.duration*1000)};
}
/** Called inside one transaction: receipts and usage commit or roll back together. */
export async function recordDailyUsage(db: PoolClient, event: {id?:unknown;type?:unknown;payload?:unknown}) {
    if (!["participant.left","meeting.ended"].includes(String(event.type))) return {ignored:true};
    const payload=event.payload as Record<string,unknown>;
    if (typeof event.id!=="string" || !event.id || event.id.length>200 || !payload || typeof payload.room!=="string" || !/^z-[a-f0-9]{40}$/.test(payload.room)) throw new ApiError("Invalid video event.");
    await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))",["daily-usage:"+payload.room]);
    const room=(await db.query("select * from private.daily_room_usage where room_name=$1 for update",[payload.room])).rows[0];
    if(!room) return {ignored:true};
    const digest=createHash("sha256").update(JSON.stringify(event)).digest("hex");
    const prior=(await db.query("select payload_hash from private.daily_webhook_receipts where event_id=$1",[event.id])).rows[0];
    if(prior) {
        if(prior.payload_hash!==digest) throw new ApiError("Video event reference changed.",409);
        return {duplicate:true};
    }
    if(event.type==="participant.left") {
        const participant=dailyParticipant(payload);
        const joined=participant.joinedAt.getTime(), earliest=new Date(room.starts_at).getTime()-15*60000, latest=new Date(room.expires_at).getTime();
        const anomaly=joined<earliest-1000 || joined+participant.durationMs>latest+300000;
        await db.query("insert into private.daily_participant_usage(room_name,session_id,joined_at,duration_ms,anomaly) values($1,$2,$3,$4,$5) on conflict(room_name,session_id) do nothing",[room.room_name,participant.sessionId,participant.joinedAt,participant.durationMs,anomaly]);
    } else {
        if(typeof payload.end_ts!=="number" || !Number.isFinite(payload.end_ts) || payload.end_ts<0 || payload.end_ts>8640000000000) throw new ApiError("Invalid video meeting end.");
        await db.query("update private.daily_room_usage set last_meeting_ended_at=greatest(last_meeting_ended_at,$2) where room_name=$1",[room.room_name,new Date(payload.end_ts*1000)]);
    }
    await db.query("insert into private.daily_webhook_receipts(event_id,room_name,kind,payload_hash) values($1,$2,$3,$4)",[event.id,room.room_name,event.type,digest]);
    // Webhooks can be delayed or lost. Keep the spending reservation intact until
    // a complete provider reconciliation; a meeting-ended event cannot prove completeness.
    return {received:true};
}
