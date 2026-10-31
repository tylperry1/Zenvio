import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { integrationValue } from '@/lib/platform-settings';
import { verifyResendWebhook } from '@/lib/resend-webhook';
import { readUpload } from '@/lib/uploads';
import { inboundDomain, emailAddress, inboundAuthenticated, inboundReplyToken, replyTokenHash } from '@/lib/launch/inbound-email';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
    if (!inboundDomain())
        return new Response(null, { status: 204 });
    let raw: string;
    try {
        raw = (await readUpload(request, 64000)).toString('utf8');
    }
    catch {
        return new Response(null, { status: 413 });
    }
    const id = request.headers.get('svix-id') || '', secret = await integrationValue('RESEND_INBOUND_WEBHOOK_SECRET');
    if (!secret || !verifyResendWebhook({ payload: raw, id, timestamp: request.headers.get('svix-timestamp') || '', signature: request.headers.get('svix-signature') || '', secret }))
        return Response.json({ error: 'Invalid signature.' }, { status: 401 });
    let event: any;
    try {
        event = JSON.parse(raw);
    }
    catch {
        return new Response(null, { status: 400 });
    }
    if (event.type !== 'email.received')
        return new Response(null, { status: 204 });
    const emailId = event.data?.email_id;
    if (typeof emailId !== 'string' || !/^[a-f0-9-]{36}$/i.test(emailId))
        return new Response(null, { status: 400 });
    const pool = getPool();
    if ((await pool.query('select 1 from private.inbound_email_receipts where provider_email_id=$1', [emailId])).rowCount)
        return new Response(null, { status: 204 });
    const key = await integrationValue('RESEND_API_KEY');
    if (!key)
        return new Response(null, { status: 503 });
    let received: any;
    try {
        const r = await fetch('https://api.resend.com/emails/receiving/' + encodeURIComponent(emailId), { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(10000) });
        if (!r.ok)
            throw Error();
        received = JSON.parse((await readUpload(r, 250000)).toString('utf8'));
        if (received.id !== emailId)
            throw Error();
    }
    catch {
        return new Response(null, { status: 503 });
    }
    const from = emailAddress(received.from), targets = (Array.isArray(received.to) ? received.to : []).map(emailAddress).filter((a: any) => a && inboundReplyToken(a));
    let state = 'quarantined', reason = 'Unknown or ambiguous reply destination', thread: any = null;
    const db = await pool.connect();
    try {
        await db.query('begin');
        await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))', ['resend-inbound:' + emailId]);
        if ((await db.query('select 1 from private.inbound_email_receipts where provider_email_id=$1', [emailId])).rowCount) {
            await db.query('commit');
            return new Response(null, { status: 204 });
        }
        if (targets.length === 1) {
            const token = inboundReplyToken(targets[0]);
            thread = (await db.query('select a.*,t.contact_id,c.email current_sender from private.thread_reply_addresses a join private.message_threads t on t.id=a.thread_id and t.user_id=a.user_id join public.contacts c on c.id=t.contact_id and c.user_id=t.user_id where a.token_hash=$1 and a.expires_at>now() for update of a,t', [replyTokenHash(token!)])).rows[0];
        }
        if (thread) {
            if (!inboundAuthenticated(received))
                reason = 'Provider-reported sender authentication failed';
            else if (!from || from !== thread.expected_sender || from !== thread.current_sender)
                reason = 'Reply sender does not match the thread participant';
            else if (typeof received.text !== 'string' || !received.text.trim() || received.text.length > 5000)
                reason = 'Plain-text body is missing or exceeds the supported limit';
            else {
                state = 'accepted';
                reason = Array.isArray(received.attachments) && received.attachments.length ? 'Plain-text accepted; attachments withheld' : 'Authenticated plain-text reply';
                const message = received.text.trim() + (received.attachments?.length ? '\n\n[Attachments withheld. Use the secure client portal to share files.]' : '');
                await db.query("insert into private.thread_messages(thread_id,direction,channel,author_name,body,status) values($1,'inbound','email',$2,$3,'received')", [thread.thread_id, from, message.slice(0, 5000)]);
                await db.query("update private.message_threads set last_message_at=now(),status='open' where id=$1", [thread.thread_id]);
            }
        }
        await db.query('insert into private.inbound_email_receipts(provider_email_id,provider_event_id,thread_id,user_id,state,reason,body_digest) values($1,$2,$3,$4,$5,$6,$7)', [emailId, id, thread?.thread_id || null, thread?.user_id || null, state, reason, createHash('sha256').update(String(received.text || '')).digest('hex')]);
        await db.query('commit');
        return new Response(null, { status: 204 });
    }
    catch {
        await db.query('rollback');
        return new Response(null, { status: 503 });
    }
    finally {
        db.release();
    }
}
