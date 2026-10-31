import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { ApiError, failure, sameOrigin, session, string, uuid } from "@/lib/server";
import { allowRequest } from "@/lib/booking-protection";
import { accessibleThread } from "@/lib/messaging";
import { attachmentResponse, normalizeAttachment, readUpload } from "@/lib/uploads";
export const dynamic = "force-dynamic";

// Download is limited to people who can open the conversation.
export async function GET(request: NextRequest) {
  try {
    const { user } = await session();
    const id = uuid(request.nextUrl.searchParams.get("id"));
    const file = (
      await getPool().query("SELECT thread_id,filename,content_type,data FROM private.message_attachments WHERE id=$1", [id])
    ).rows[0];
    if (!file) throw new ApiError("Attachment not found.", 404);
    await accessibleThread(getPool(), user.id, file.thread_id);
    return attachmentResponse(file, request.nextUrl.searchParams.get("inline") === "1");
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { user } = await session();
    const t = await accessibleThread(getPool(), user.id, uuid(request.nextUrl.searchParams.get("thread")));
    if (!(await allowRequest("inbox-upload", user.id, 20, 300)))
      throw new ApiError("Too many uploads. Please wait and try again.", 429);
    const file = await normalizeAttachment(
      await readUpload(request, 5000000),
      string(request.nextUrl.searchParams.get("name") || "attachment", "file name", 200),
    );
    const { rows } = await getPool().query(
      "INSERT INTO private.message_attachments(thread_id,filename,content_type,size,data) VALUES($1,$2,$3,$4,$5) RETURNING id,filename,content_type,size",
      [t.id, file.filename, file.contentType, file.data.length, file.data],
    );
    return Response.json(rows[0], { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
