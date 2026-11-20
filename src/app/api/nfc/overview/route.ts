import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { failure, session } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  try {
    const { token: owner } = await session();
    const db = getPool();
    const [tags, ops, recent] = await Promise.all([
      db.query(
        `SELECT
           count(*)::int AS total,
           count(*) FILTER (WHERE status IN ('programmed','assigned'))::int AS programmed,
           count(*) FILTER (WHERE smart_card_id IS NOT NULL)::int AS assigned,
           count(*) FILTER (WHERE status='failed')::int AS failed
         FROM private.nfc_tags WHERE user_id=$1`,
        [owner],
      ),
      db.query(
        `SELECT
           count(*) FILTER (WHERE status='failed')::int AS failed_ops,
           count(*) FILTER (WHERE status='succeeded')::int AS succeeded_ops
         FROM private.nfc_operations WHERE user_id=$1 AND started_at > now() - interval '30 days'`,
        [owner],
      ),
      db.query(
        `SELECT id, operation_type, status, payload_summary, platform, started_at, completed_at, error_message
           FROM private.nfc_operations WHERE user_id=$1 ORDER BY started_at DESC LIMIT 12`,
        [owner],
      ),
    ]);
    const t = tags.rows[0] || {};
    const o = ops.rows[0] || {};
    return Response.json({
      totals: {
        tags: t.total || 0,
        programmed: t.programmed || 0,
        assigned: t.assigned || 0,
        failedTags: t.failed || 0,
        failedOps30d: o.failed_ops || 0,
        succeededOps30d: o.succeeded_ops || 0,
      },
      recent: recent.rows,
    });
  } catch (e) {
    return failure(e);
  }
}
