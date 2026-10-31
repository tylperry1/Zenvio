import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { sealSecret, unsealSecret } from '../platform-settings';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function inboundDomain() { const domain = (process.env.RESEND_INBOUND_DOMAIN || '').toLowerCase(); return process.env.RESEND_INBOUND_ENABLED === 'true' && process.env.RESEND_INBOUND_DOMAIN_VERIFIED === 'true' && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain) ? domain : null; }
export function emailAddress(value: unknown) { if (typeof value !== 'string' || value.length > 320)
    return null; const angle = value.match(/<([^<>]+)>\s*$/), address = (angle ? angle[1] : value).trim().toLowerCase(); return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(address) ? address : null; }
export function inboundAuthenticated(message: any) { return message?.authentication?.dmarc === 'pass' && (message.authentication.dkim === 'pass' || message.authentication.spf === 'pass'); }
export async function threadReplyAddress(db: PoolClient, threadId: string, userId: string, sender: string) { const domain = inboundDomain(); if (!domain)
    return null; await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))', ['thread-reply:' + threadId]); let row = (await db.query('select * from private.thread_reply_addresses where thread_id=$1 and user_id=$2 for update', [threadId, userId])).rows[0]; let token: string; if (row && row.expected_sender === sender && new Date(row.expires_at).getTime() > Date.now())
    token = unsealSecret(row.token_ciphertext);
else {
    token = randomBytes(24).toString('hex');
    await db.query("insert into private.thread_reply_addresses(thread_id,user_id,token_hash,token_ciphertext,expected_sender) values($1,$2,$3,$4,$5) on conflict(thread_id) do update set token_hash=$3,token_ciphertext=$4,expected_sender=$5,expires_at=now()+interval '90 days'", [threadId, userId, hash(token), sealSecret(token), sender]);
} return `reply+${token}@${domain}`; }
export function inboundReplyToken(address: string) { const domain = inboundDomain(); if (!domain)
    return null; const suffix = '@' + domain; if (!address.endsWith(suffix))
    return null; const local = address.slice(0, -suffix.length); return /^reply\+[a-f0-9]{48}$/.test(local) ? local.slice(6) : null; }
export const replyTokenHash = hash;
