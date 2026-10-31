import { getPool } from "../db";
import { sealSecret, unsealSecret } from "../platform-settings";
import { ApiError } from "../server";
import { assertSmsConsent, normalizeE164 } from "../twilio";
import type { SmsReadiness, SmsSendResult } from "../sms";
import { telnyxConfigured, telnyxSend, smsDigest, smsSegments } from "./telnyx";
import { reserveUsage, uncertainUsage } from "./provider-policy";
export async function telnyxReadiness(input: {
    userId: string;
    to: string;
    body: string;
}): Promise<SmsReadiness> {
    if (process.env.TELNYX_MESSAGING_ENABLED !== "true" || !await telnyxConfigured())
        return { ok: false, reason: "provider_disabled", detail: "Telnyx messaging has not passed activation." };
    const features=(await getPool().query("select value from private.platform_settings where key='integration_features'")).rows[0]?.value;
    if(features?.sms!==true)return {ok:false,reason:"provider_disabled",detail:"SMS is suspended by the platform administrator."};
    const to = normalizeE164(input.to);
    if (!input.body.trim() || input.body.length > 1600)
        throw new ApiError("Write 1–1,600 SMS characters.");
    await assertSmsConsent(input.userId, to);
    const c = (await getPool().query("select * from private.sms_provider_connections where user_id=$1 and provider='telnyx'", [input.userId])).rows[0];
    if (!c?.messaging_enabled || !c.messaging_profile_id || !c.registration_verified_at || !["approved", "not_required"].includes(c.registration_state))
        return { ok: false, reason: "provider_disabled", detail: "The SMS sender, messaging profile and carrier registration require verification." };
    return { ok: true, sender: c.sender_number, preview: input.body.trim() };
}
export async function queueSms(input: {
    userId: string;
    to: string;
    body: string;
    reference: string;
    bookingId?: string;
    bookingRevision?: number;
}): Promise<SmsSendResult> {
    const to = normalizeE164(input.to), text = input.body.trim(), digest = smsDigest(to, text);
    if (!/^[A-Za-z0-9._:-]{16,120}$/.test(input.reference))
        throw new ApiError("Invalid message reference.");
    const ready = await telnyxReadiness({ ...input, to, body: text });
    if (!ready.ok)
        throw new ApiError(ready.detail, 409);
    const db = await getPool().connect();
    try {
        await db.query("begin");
        await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", ["sms-queue:" + input.userId]);
        const existing = (await db.query("select * from private.sms_outbox where user_id=$1 and reference=$2", [input.userId, input.reference])).rows[0];
        if (existing) {
            if (existing.body_digest !== digest)
                throw new ApiError("Message reference already used for different content.", 409);
            await db.query("commit");
            return { status: existing.state === "delivered" ? "delivered" : ["failed", "suppressed", "uncertain"].includes(existing.state) ? "failed" : existing.state === "accepted" ? "sent" : "queued", providerId: existing.provider_message_id || null, detail: existing.last_error || undefined };
        }
        if (input.bookingId) {
            const booking = (await db.query("select id from public.bookings where id=$1 and user_id=$2 and revision=$3 and status='confirmed' and starts_at>now() and guest_phone=$4 for share", [input.bookingId,input.userId,input.bookingRevision,input.to])).rows[0];
            if (!booking) throw new ApiError("Appointment reminder is no longer current.",409);
        }
        const n = (await db.query("select count(*)::int n from private.sms_outbox where user_id=$1 and created_at>now()-interval '1 hour'", [input.userId])).rows[0].n;
        if (n >= 60)
            throw new ApiError("SMS hourly limit reached.", 429);
        await db.query("insert into private.sms_outbox(user_id,reference,to_number,ciphertext,body_digest,provider,booking_id,booking_revision) values($1,$2,$3,$4,$5,'telnyx',$6,$7)", [input.userId, input.reference, to, sealSecret(text), digest,input.bookingId||null,input.bookingRevision??null]);
        await db.query("commit");
        return { status: "queued", providerId: null };
    }
    catch (e) {
        await db.query("rollback");
        throw e;
    }
    finally {
        db.release();
    }
}
function cap(name: string) { const n = Number(process.env[name] || 0); return Number.isSafeInteger(n) && n >= 0 ? n : 0; }
export async function drainSmsOutbox(limit = 10) {
    const pool = getPool();
    // A crash after claiming can mean the provider accepted the send. Never auto-resend.
    await pool.query("update private.sms_outbox set state='uncertain',last_error='Sender interrupted. Provider reconciliation required.' where state='sending' and claimed_at<now()-interval '5 minutes'");
    let accepted = 0;
    for (let i = 0; i < Math.min(limit, 20); i++) {
        const row = (await pool.query(`update private.sms_outbox set state='sending',claimed_at=now()
      where id=(select id from private.sms_outbox where state='queued' order by created_at for update skip locked limit 1) returning *`)).rows[0];
        if (!row)
            break;
        let usageId: string | undefined, attempted = false;
        try {
            // Inbox enqueue can precede its outer transaction commit. Only dispatch committed messages.
            if (row.booking_id) {
                if(process.env.SMS_APPOINTMENT_REMINDERS_ENABLED!=="true") throw new ApiError("Appointment SMS reminders are disabled.",409);
                const b=(await pool.query("select b.id from public.bookings b where b.id=$1 and b.user_id=$2 and b.revision=$3 and b.status='confirmed' and b.starts_at>now() and b.guest_phone=$4 and exists(select 1 from private.contact_consents c where c.user_id=b.user_id and c.phone_e164=$4 and c.scope='appointment' and c.status='opted_in')",[row.booking_id,row.user_id,row.booking_revision,row.to_number])).rows[0];
                if(!b) throw new ApiError("Appointment changed, expired, or appointment consent is unavailable.",409);
            }
            const origin = row.booking_id ? true : (await pool.query(`select 1 from private.message_records where id::text=$1 and user_id=$2
        union all select 1 from private.thread_messages m join private.message_threads t on t.id=m.thread_id where m.id::text=$1 and t.user_id=$2`, [row.reference, row.user_id])).rows[0];
            if (!origin) {
                await pool.query("update private.sms_outbox set state=case when created_at<now()-interval '10 minutes' then 'suppressed' else 'queued' end,claimed_at=null,last_error='Awaiting committed source message.' where id=$1", [row.id]);
                break;
            }
            const text = unsealSecret(row.ciphertext), ready = await telnyxReadiness({ userId: row.user_id, to: row.to_number, body: text });
            if (!ready.ok)
                throw new ApiError(ready.detail, 409);
            const connection = (await pool.query("select messaging_profile_id from private.sms_provider_connections where user_id=$1 and provider='telnyx'", [row.user_id])).rows[0];
            const perSegment = cap("TELNYX_MAX_SEGMENT_MICROS");
            usageId = await reserveUsage({ userId: row.user_id, provider: "telnyx", micros: smsSegments(text) * perSegment, platformCap: cap("TELNYX_MONTHLY_CAP_MICROS"), workspaceCap: cap("TELNYX_WORKSPACE_CAP_MICROS") });
            await pool.query("update private.sms_outbox set usage_id=$2 where id=$1", [row.id, usageId]);
            attempted = true;
            const providerId = await telnyxSend({ to: row.to_number, from: ready.sender, profile: connection.messaging_profile_id, text });
            await pool.query("update private.sms_outbox set state=case when state='delivered' then state else 'accepted' end,provider_message_id=$2,finished_at=now() where id=$1", [row.id, providerId]);
            await pool.query("update private.message_records set state=case when state='delivered' then state else 'provider_accepted' end,provider='telnyx',provider_message_id=$2,sent_at=now() where id::text=$1 and user_id=$3", [row.reference, providerId, row.user_id]);
            await pool.query("update private.thread_messages set status='sent' where id::text=$1 and thread_id in(select id from private.message_threads where user_id=$2)", [row.reference, row.user_id]);
            accepted++;
        }
        catch (e) {
            if (usageId)
                await uncertainUsage(usageId);
            await pool.query("update private.sms_outbox set state=$2,last_error=$3,finished_at=now() where id=$1", [row.id, attempted ? "uncertain" : "suppressed", attempted ? "Provider acceptance unknown; reconcile before retry." : e instanceof ApiError ? e.message : "Message validation failed."]);
            await pool.query("update private.message_records set state='failed',failure_code=$2,uncertain_at=case when $2='uncertain' then now() else null end where id::text=$1 and state in ('queued','sending')", [row.reference, attempted ? "uncertain" : "suppressed"]);
        }
    }
    return { accepted };
}

/** Only reminders due now are queued; current booking revision is checked again at dispatch. */
export async function materializeSmsReminders() {
    if(process.env.SMS_APPOINTMENT_REMINDERS_ENABLED!=="true" || process.env.TELNYX_MESSAGING_ENABLED!=="true") return {queued:0};
    const rows=(await getPool().query(`select b.id,b.user_id,b.revision,b.guest_phone,b.starts_at,e.title,p.timezone,m.minutes
      from public.bookings b join public.event_types e on e.id=b.event_id join public.profiles p on p.id=b.user_id
      cross join lateral unnest(e.reminder_minutes) m(minutes)
      where b.status='confirmed' and b.booking_kind='appointment' and b.starts_at>now()
      and b.starts_at-make_interval(mins=>m.minutes)<=now()
      and b.starts_at-make_interval(mins=>m.minutes)>now()-interval '10 minutes'
      and b.guest_phone ~ '^[+][1-9][0-9]{7,14}$'
      and exists(select 1 from private.contact_consents c where c.user_id=b.user_id and c.phone_e164=b.guest_phone and c.scope='appointment' and c.status='opted_in')
      and not exists(select 1 from private.sms_outbox o where o.user_id=b.user_id and o.reference='reminder:'||b.id||':'||b.revision||':'||m.minutes)
      order by b.starts_at limit 20`)).rows;
    let queued=0;
    for(const b of rows) {
        const when=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:b.timezone}).format(new Date(b.starts_at));
        try {
            await queueSms({userId:b.user_id,to:b.guest_phone,body:`Appointment reminder: ${b.title.slice(0,150)}. ${when} (${b.timezone}). Reply STOP to opt out.`,reference:`reminder:${b.id}:${b.revision}:${b.minutes}`,bookingId:b.id,bookingRevision:b.revision});
            queued++;
        } catch(e) { if(!(e instanceof ApiError)) throw e; }
    }
    return {queued};
}
