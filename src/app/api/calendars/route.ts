import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { session, sameOrigin, body, failure, ApiError } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const { token } = await session();
    const { rows } = await getPool().query(
      "SELECT token,updated_at FROM private.calendar_feeds WHERE user_id=$1",
      [token],
    );
    return Response.json(
      { feed: rows[0] || null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token } = await session();
    const input = await body(request);
    if (input.action === "disconnect")
      await getPool().query(
        "DELETE FROM private.calendar_feeds WHERE user_id=$1",
        [token],
      );
    else if (input.action === "connect" || input.action === "rotate")
      await getPool().query(
        "INSERT INTO private.calendar_feeds(user_id) VALUES($1) ON CONFLICT(user_id) DO UPDATE SET token=gen_random_uuid(),updated_at=now()",
        [token],
      );
    else throw new ApiError("Invalid calendar action.");
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
