import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { adminSession } from "@/lib/admin";
import { ApiError, body, failure, sameOrigin } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await adminSession("marketplace");
    const db = getPool();
    const [settings, totals, recentErrors] = await Promise.all([
      db.query(`SELECT value FROM private.platform_settings WHERE key='nfc_studio'`),
      db.query(
        `SELECT
           (SELECT count(*)::int FROM private.nfc_tags) AS tags,
           (SELECT count(*)::int FROM private.nfc_operations) AS operations,
           (SELECT count(*)::int FROM private.nfc_operations WHERE status='succeeded') AS succeeded,
           (SELECT count(*)::int FROM private.nfc_operations WHERE status='failed') AS failed,
           (SELECT count(*)::int FROM private.nfc_batches) AS batches`,
      ),
      db.query(
        `SELECT error_code, count(*)::int AS total
           FROM private.nfc_operations
          WHERE status='failed' AND started_at > now() - interval '30 days' AND error_code<>''
          GROUP BY 1 ORDER BY total DESC LIMIT 12`,
      ),
    ]);
    return Response.json({
      enabled: settings.rows[0]?.value?.enabled !== false,
      totals: totals.rows[0],
      errorTrends: recentErrors.rows,
      platforms: {
        webNfc: "Optional Android Chrome NDEF only",
        iosNative: "Requires Capacitor shell + Core NFC entitlement",
        androidNative: "Requires Capacitor shell + NFC permission",
      },
    });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token, access } = await adminSession("marketplace");
    if (access.role !== "master_admin") throw new ApiError("Only the master admin can change NFC Studio availability.", 403);
    const input = await body(request);
    if (typeof input.enabled !== "boolean") throw new ApiError("Choose NFC Studio visibility.");
    await getPool().query(
      `UPDATE private.platform_settings SET value=value||$1::jsonb, updated_at=now() WHERE key='nfc_studio'`,
      [JSON.stringify({ enabled: input.enabled })],
    );
    await getPool().query("INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'nfc_studio_visibility',$2)", [
      token,
      JSON.stringify({ enabled: input.enabled }),
    ]);
    return Response.json({ ok: true, enabled: input.enabled });
  } catch (e) {
    return failure(e);
  }
}
