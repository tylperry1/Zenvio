import { NextRequest } from "next/server";
import { adminSession } from "@/lib/admin";
import { getPool } from "@/lib/db";
import {
  parsePlatformSocialLinks,
  platformSocialLabels,
  platformSocialLinksStrict,
  platformSocialNetworks,
} from "@/lib/platform-social";
import { ApiError, body, failure, sameOrigin, string } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await adminSession(); // master admin only
    return Response.json(
      {
        links: await platformSocialLinksStrict(),
        networks: platformSocialNetworks.map((id) => ({
          id,
          label: platformSocialLabels[id],
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token } = await adminSession(); // master admin only
    const input = await body(request);
    const reason = string(input.reason, "reason", 500, 5);
    const links = parsePlatformSocialLinks(input.links);
    const payload = { links };
    const db = await getPool().connect();
    try {
      await db.query("BEGIN");
      await db.query(
        "INSERT INTO private.platform_settings(key,value) VALUES('platform_social_links',$1) ON CONFLICT(key) DO UPDATE SET value=$1,updated_at=now()",
        [JSON.stringify(payload)],
      );
      await db.query(
        "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'platform_social_links_updated',$2)",
        [token, JSON.stringify({ reason, links })],
      );
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
    return Response.json({ ok: true, links });
  } catch (e) {
    return failure(e);
  }
}
