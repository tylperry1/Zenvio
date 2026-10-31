import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { ApiError, body, failure, sameOrigin, session, uuid } from "@/lib/server";
import { createPortalLink } from "@/lib/portal";
export const dynamic = "force-dynamic";

// Hosts create a private portal link for one client, or revoke every link for that client.
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { user } = await session();
    const input = await body(request);
    const contactId = uuid(input.contactId);
    if (input.action === "revoke") {
      const { rowCount } = await getPool().query(
        "UPDATE private.portal_links SET revoked_at=now() WHERE user_id=$1 AND contact_id=$2 AND revoked_at IS NULL",
        [user.id, contactId],
      );
      return Response.json({ revoked: rowCount });
    }
    const db = await getPool().connect();
    try {
      const link = await createPortalLink(db, user.id, contactId);
      return Response.json({ url: link.url, expiresInDays: 30 });
    } catch (e) {
      if ((e as Error).message === "portal_contact_not_found") throw new ApiError("Client not found.", 404);
      throw e;
    } finally {
      db.release();
    }
  } catch (e) {
    return failure(e);
  }
}
