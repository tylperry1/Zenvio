import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { ApiError, failure, uuid } from "@/lib/server";
import { allowRequest, clientIp } from "@/lib/booking-protection";
import { resolvePortal } from "@/lib/portal";
import { attachmentResponse } from "@/lib/uploads";
export const dynamic = "force-dynamic";

// Clients can download attachments sent in their own conversation, never internal notes.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    if (!(await allowRequest("portal", clientIp(request), 120, 60))) throw new ApiError("Too many requests.", 429);
    const s = await resolvePortal((await params).token);
    if (!s) throw new ApiError("This portal link has expired.", 404);
    const file = (
      await getPool().query(
        `SELECT a.filename,a.content_type,a.data FROM private.message_attachments a
           JOIN private.thread_messages m ON m.id=a.message_id JOIN private.message_threads t ON t.id=a.thread_id
          WHERE a.id=$1 AND t.user_id=$2 AND t.contact_id=$3 AND m.direction<>'internal'`,
        [uuid(request.nextUrl.searchParams.get("id")), s.userId, s.contactId],
      )
    ).rows[0];
    if (!file) throw new ApiError("Attachment not found.", 404);
    return attachmentResponse(file);
  } catch (e) {
    return failure(e);
  }
}
