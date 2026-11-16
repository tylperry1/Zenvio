import { getPool } from "./db";
import { threadAccess } from "./messaging";

/**
 * Cheap fingerprint of a host's bookings, inbox, clients, jobs, payments and
 * documents. The live stream probes this every 1.5 s and the client refetches
 * the normal APIs only when it moves.
 */
export async function workspaceSignature(userId: string) {
  const { rows } = await getPool().query(
    `SELECT
       (SELECT coalesce(count(*)::text,'0') || ':' ||
               coalesce(sum(extract(epoch from starts_at))::bigint::text,'0') || ':' ||
               coalesce(count(*) FILTER (WHERE status='cancelled')::text,'0')
          FROM public.bookings WHERE user_id=$1) bookings,
       (SELECT coalesce(md5(string_agg(t.id::text||t.status||coalesce(t.assigned_to::text,'')||t.last_message_at::text, ',' ORDER BY t.id)), '')
          FROM private.message_threads t WHERE ${threadAccess}) inbox,
       (SELECT coalesce(count(*) FILTER (WHERE m.direction='inbound' AND m.read_at IS NULL)::text,'0') || ':' ||
               coalesce(max(m.created_at)::text,'')
          FROM private.thread_messages m JOIN private.message_threads t ON t.id=m.thread_id WHERE ${threadAccess}) messages,
       (SELECT coalesce(count(*)::text,'0') || ':' || coalesce(max(created_at)::text,'') FROM public.contacts WHERE user_id=$1) contacts,
       (SELECT coalesce(max(updated_at)::text,'') || ':' || coalesce(count(*)::text,'0') FROM private.jobs WHERE user_id=$1) jobs,
       (SELECT coalesce(count(*)::text,'0') || ':' || coalesce(max(updated_at)::text,'') || ':' || coalesce(max(status),'') FROM private.estimates WHERE user_id=$1) estimates,
       (SELECT coalesce(count(*)::text,'0') || ':' || coalesce(max(created_at)::text,'') || ':' || coalesce(max(paid_at)::text,'') || ':' ||
               coalesce(md5(string_agg(id::text||status, ',' ORDER BY id)), '')
          FROM private.payment_requests WHERE user_id=$1) payments,
       (SELECT coalesce(count(*)::text,'0') || ':' || coalesce(max(created_at)::text,'') || ':' || coalesce(max(completed_at)::text,'') || ':' ||
               coalesce(md5(string_agg(id::text||status, ',' ORDER BY id)), '')
          FROM private.signature_envelopes WHERE user_id=$1) documents,
       (SELECT coalesce(count(*)::text,'0') || ':' || coalesce(max(created_at)::text,'') || ':' || coalesce(max(status),'') FROM private.appointment_payments WHERE user_id=$1) receipts,
       (SELECT coalesce(count(*)::text,'0') || ':' || coalesce(max(created_at)::text,'') || ':' || coalesce(max(signed_at)::text,'') || ':' || coalesce(max(status),'')
          FROM private.signing_documents WHERE user_id=$1) agreements`,
    [userId],
  );
  return rows[0];
}
