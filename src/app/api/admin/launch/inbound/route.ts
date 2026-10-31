import { adminSession } from '@/lib/admin';
import { getPool } from '@/lib/db';
import { failure } from '@/lib/server';
import { inboundDomain } from '@/lib/launch/inbound-email';
export const dynamic = 'force-dynamic';
export async function GET() { try {
    await adminSession();
    const { rows } = await getPool().query('select provider_email_id,thread_id,state,reason,created_at from private.inbound_email_receipts order by created_at desc limit 100');
    return Response.json({ configured: !!inboundDomain(), receipts: rows }, { headers: { 'Cache-Control': 'no-store' } });
}
catch (e) {
    return failure(e);
} }
