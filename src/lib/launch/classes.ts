import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool } from '../db';
import { ApiError } from '../server';
import { filterGoogleSlots } from '../google-calendar';
import { filterMicrosoftSlots } from '../microsoft-calendar';
import { queueDelivery, scheduleBooking, appOrigin } from '../lifecycle';
import { sealSecret, unsealSecret } from '../platform-settings';
import { applyBalanceEntry } from './balances';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export async function createClass(userId: string, input: {
    eventId: string;
    title: string;
    description: string;
    startsAt: string;
    capacity: number;
    published: boolean;
    creditCost: number;
    creditUnit: string;
}) {
    const pool = getPool(), pre = (await pool.query('select e.*,p.slug host_slug from public.event_types e join public.profiles p on p.id=e.user_id where e.id=$1 and e.user_id=$2 and e.active and e.deleted_at is null', [input.eventId, userId])).rows[0];
    if (!pre)
        throw new ApiError('Appointment type not found.', 404);
    if (pre.payment_mode !== 'free')
        throw new ApiError('Use a free appointment type for classes; paid admission uses verified credits only.', 409);
    const available = await filterMicrosoftSlots(pre.host_slug, pre.slug, await filterGoogleSlots(pre.host_slug, pre.slug, [input.startsAt]));
    if (!available.length)
        throw new ApiError('This time conflicts with a calendar.', 409);
    const db = await pool.connect();
    try {
        await db.query('begin');
        await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [userId]);
        const e = (await db.query('select e.*,p.slug host_slug,p.timezone,u.name,u.email from public.event_types e join public.profiles p on p.id=e.user_id join public."user" u on u.id=e.user_id where e.id=$1 and e.user_id=$2 and e.active and e.deleted_at is null for share of e', [input.eventId, userId])).rows[0];
        if (!e || e.duration !== pre.duration || e.buffer !== pre.buffer || e.payment_mode !== 'free')
            throw new ApiError('The appointment type changed. Review the class.', 409);
        const slot = await db.query("select 1 from public.public_slots($1,$2,($3::timestamptz at time zone $4)::date) where starts_at=$3", [e.host_slug, e.slug, input.startsAt, e.timezone]);
        if (!slot.rowCount)
            throw new ApiError('This class time is unavailable.', 409);
        const end = new Date(Date.parse(input.startsAt) + e.duration * 60000).toISOString(), blocked = new Date(Date.parse(end) + e.buffer * 60000).toISOString();
        // A real organizer reservation occupies the host calendar once; attendees share its session capacity.
        const booking = (await db.query("insert into public.bookings(user_id,event_id,guest_name,guest_email,starts_at,ends_at,blocked_until,booking_kind) values($1,$2,$3,$4,$5,$6,$7,'class') returning id", [userId, e.id, e.name, e.email, input.startsAt, end, blocked])).rows[0];
        const row = (await db.query('insert into private.class_sessions(user_id,event_id,anchor_booking_id,title,description,capacity,published,starts_at,ends_at,cancellation_notice_minutes,credit_cost,credit_unit) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *', [userId, e.id, booking.id, input.title, input.description, input.capacity, input.published, input.startsAt, end, e.cancellation_notice_minutes, input.creditCost, input.creditUnit])).rows[0];
        await scheduleBooking(db, booking.id);
        await db.query('commit');
        return row;
    }
    catch (e) {
        await db.query('rollback');
        if ((e as any).code === '23P01')
            throw new ApiError('This time was just booked.', 409);
        throw e;
    }
    finally {
        db.release();
    }
}
export async function publicClass(id: string) {
    const s = (await getPool().query(`select s.id,s.title,s.description,s.starts_at,s.ends_at,s.capacity,s.credit_cost,s.credit_unit,p.timezone,
  (s.capacity-(select count(*) from private.class_registrations r where r.session_id=s.id and r.state='confirmed'))::int remaining
  from private.class_sessions s join public.event_types e on e.id=s.event_id join public.profiles p on p.id=s.user_id join public.bookings b on b.id=s.anchor_booking_id
  where s.id=$1 and e.active and e.deleted_at is null and s.published and s.state='scheduled' and b.status='confirmed' and s.starts_at>now()`, [id])).rows[0];
    if (!s)
        throw new ApiError('Class not found.', 404);
    return s;
}
export async function registerClass(id: string, input: {
    name: string;
    email: string;
    reference: string;
    hostUserId?: string;
    contactId?: string;
    balanceAccountId?: string;
}) {
    const db = await getPool().connect(), digest = hash(JSON.stringify({ name: input.name, email: input.email, contactId: input.contactId || null, balanceAccountId: input.balanceAccountId || null }));
    try {
        await db.query('begin');
        const s = (await db.query("select s.* from private.class_sessions s join public.event_types e on e.id=s.event_id join public.bookings b on b.id=s.anchor_booking_id where s.id=$1 and e.active and e.deleted_at is null and s.state='scheduled' and b.status='confirmed' and s.starts_at>now() and (s.published or s.user_id=$2::uuid) for update of s", [id, input.hostUserId || null])).rows[0];
        if (!s)
            throw new ApiError('Class not found.', 404);
        if (input.hostUserId && s.user_id !== input.hostUserId)
            throw new ApiError('Class not found.', 404);
        const prior = (await db.query('select * from private.class_registrations where session_id=$1 and reference=$2', [id, input.reference])).rows[0];
        if (prior) {
            if (prior.digest !== digest)
                throw new ApiError('Registration reference was used for different details.', 409);
            await db.query('commit');
            return { id: prior.id, state: prior.state, cancelToken: unsealSecret(prior.cancel_token_ciphertext), duplicate: true };
        }
        const used = Number((await db.query("select count(*) n from private.class_registrations where session_id=$1 and state='confirmed'", [id])).rows[0].n);
        if (used >= s.capacity)
            throw new ApiError('This class is full.', 409);
        let contact: any;
        if (input.contactId) {
            contact = (await db.query('select id,name,email from public.contacts where id=$1 and user_id=$2', [input.contactId, s.user_id])).rows[0];
            if (!contact || contact.email !== input.email)
                throw new ApiError('Client not found or email changed.', 404);
        }
        else
            contact = (await db.query('insert into public.contacts(user_id,name,email) values($1,$2,$3) on conflict(user_id,email) do update set email=excluded.email returning id,name,email', [s.user_id, input.name, input.email])).rows[0];
        if (s.credit_cost > 0 && !input.hostUserId)
            throw new ApiError('A verified host must apply package credits for this class.', 409);
        const secret = randomBytes(32).toString('hex');
        const r = (await db.query('insert into private.class_registrations(session_id,user_id,contact_id,name,email,reference,digest,cancel_token_hash,cancel_token_ciphertext,balance_account_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id', [id, s.user_id, contact.id, input.name, input.email, input.reference, digest, hash(secret), sealSecret(secret), (s.credit_cost>0?input.balanceAccountId:null) || null])).rows[0];
        if (s.credit_cost > 0) {
            const account = (await db.query("select id from private.customer_balance_accounts where id=$1 and user_id=$2 and contact_id=$3 and kind='package' and unit=$4", [input.balanceAccountId || null, s.user_id, contact.id, s.credit_unit])).rows[0];
            if (!account)
                throw new ApiError('A matching package-credit account is required.', 409);
            const debit = await applyBalanceEntry(db, { userId: s.user_id, accountId: account.id, delta: -s.credit_cost, reference: 'class-debit:' + r.id, reason: 'Class registration ' + s.title });
            await db.query('update private.class_registrations set debit_entry_id=$2 where id=$1', [r.id, debit.id]);
        }
        await queueDelivery(db, { user: s.user_id, kind: 'class_confirmation', key: 'class-confirmation:' + r.id, to: input.email, subject: 'Class confirmed: ' + s.title, text: `${input.name},\n\nYour place in ${s.title} is confirmed.\nStarts: ${new Date(s.starts_at).toISOString()}\nEnds: ${new Date(s.ends_at).toISOString()}\n\nManage this registration: ${appOrigin()}/class-cancel#token=${secret}`, expires: new Date(s.ends_at) });
        await db.query('commit');
        return { id: r.id, state: 'confirmed', cancelToken: secret, duplicate: false };
    }
    catch (e) {
        await db.query('rollback');
        if ((e as any).code === '23505')
            throw new ApiError('This guest already has a confirmed place.', 409);
        throw e;
    }
    finally {
        db.release();
    }
}
async function cancelRegistration(db: PoolClient, r: any) {
    if (r.state !== 'confirmed')
        return;
    if (r.debit_entry_id) {
        const entry = (await db.query('select delta from private.customer_balance_entries where id=$1 and user_id=$2', [r.debit_entry_id, r.user_id])).rows[0];
        if (!entry)
            throw new ApiError('Credit history needs reconciliation.', 409);
        await applyBalanceEntry(db, { userId: r.user_id, accountId: r.balance_account_id, delta: -Number(entry.delta), reference: 'class-reversal:' + r.id, reason: 'Cancelled class registration', reversalOf: r.debit_entry_id });
    }
    await db.query("update private.class_registrations set state='cancelled',cancelled_at=now() where id=$1", [r.id]);
    await db.query("update private.delivery_jobs set status='cancelled',payload_ciphertext=null where dedupe_key=$1 and status='queued'", ['class-confirmation:' + r.id]);
    await queueDelivery(db, { user: r.user_id, kind: 'class_cancellation', key: 'class-cancellation:' + r.id, to: r.email, subject: 'Class registration cancelled', text: 'Your class registration has been cancelled. Any package credits used for this registration have been restored.' });
}
export async function cancelClassRegistration(token: string) { const db = await getPool().connect(); try {
    await db.query('begin');
    const lookup = (await db.query('select session_id from private.class_registrations where cancel_token_hash=$1', [hash(token)])).rows[0];
    if (!lookup)
        throw new ApiError('Registration not found.', 404);
    const s = (await db.query('select * from private.class_sessions where id=$1 for update', [lookup.session_id])).rows[0], r = (await db.query('select * from private.class_registrations where cancel_token_hash=$1 for update', [hash(token)])).rows[0];
    if (r.state === 'confirmed' && Date.parse(s.starts_at) <= Date.now() + s.cancellation_notice_minutes * 60000)
        throw new ApiError('The class cancellation window has closed. Contact the host.', 409);
    await cancelRegistration(db, r);
    await db.query('commit');
    return { cancelled: true };
}
catch (e) {
    await db.query('rollback');
    throw e;
}
finally {
    db.release();
} }
export async function cancelClass(userId: string, id: string) { const db = await getPool().connect(); try {
    await db.query('begin');
    await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [userId]);
    const s = (await db.query('select * from private.class_sessions where id=$1 and user_id=$2 for update', [id, userId])).rows[0];
    if (!s)
        throw new ApiError('Class not found.', 404);
    
    for (const r of (await db.query("select * from private.class_registrations where session_id=$1 and state='confirmed' order by id for update", [id])).rows)
        await cancelRegistration(db, r);
    await db.query("update private.class_sessions set state='cancelled',published=false where id=$1", [id]);
    await db.query("update public.bookings set status='cancelled' where id=$1", [s.anchor_booking_id]);
    await db.query('commit');
    return { cancelled: true };
}
catch (e) {
    await db.query('rollback');
    throw e;
}
finally {
    db.release();
} }

export async function drainClassCancellations(limit=5){
 const pool=getPool(),rows=(await pool.query('select session_id,user_id from private.class_cleanup_jobs where completed_at is null and attempts<8 order by created_at limit $1',[Math.min(20,limit)])).rows;
 for(const r of rows){try{await cancelClass(r.user_id,r.session_id);await pool.query('update private.class_cleanup_jobs set completed_at=now(),last_error=null where session_id=$1',[r.session_id]);}catch{await pool.query("update private.class_cleanup_jobs set attempts=attempts+1,last_error='Class cancellation and credit restoration need review.' where session_id=$1",[r.session_id]);}}
 return {processed:rows.length};
}
