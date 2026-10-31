import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { ApiError, failure, sameOrigin, session, slug, string, uuid } from "@/lib/server";
import { allowRequest, clientIp } from "@/lib/booking-protection";
import { attachmentResponse, normalizeAttachment, readUpload } from "@/lib/uploads";
import { purgeUnclaimedUploads, uploadKey, uploadKeyHash } from "@/lib/guest-uploads";
export const dynamic = "force-dynamic";

// Guest file upload for booking forms and service requests (photos or PDFs, 5 MB each).
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const ip = clientIp(request);
    if (!(await allowRequest("guest-upload", ip, 20, 600)))
      throw new ApiError("Too many uploads. Please wait a few minutes.", 429);
    const host = slug(request.nextUrl.searchParams.get("host"));
    const key = uploadKey(request.headers.get("x-upload-key"));
    const owner = (await getPool().query("SELECT id FROM public.profiles WHERE slug=$1", [host])).rows[0];
    if (!owner) throw new ApiError("This page is unavailable.", 404);
    const pending = (
      await getPool().query(
        "SELECT count(*)::int n FROM private.intake_uploads WHERE upload_key_hash=$1 AND booking_id IS NULL AND job_id IS NULL",
        [uploadKeyHash(key)],
      )
    ).rows[0].n;
    if (pending >= 10) throw new ApiError("You can attach up to 10 files.", 409);
    const file = await normalizeAttachment(
      await readUpload(request, 5000000),
      string(request.nextUrl.searchParams.get("name") || "upload", "file name", 200),
    );
    const { rows } = await getPool().query(
      "INSERT INTO private.intake_uploads(user_id,upload_key_hash,filename,content_type,size,data) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,filename",
      [owner.id, uploadKeyHash(key), file.filename, file.contentType, file.data.length, file.data],
    );
    if (Math.random() < 0.05) await purgeUnclaimedUploads(getPool());
    return Response.json(rows[0], { status: 201 });
  } catch (e) {
    return failure(e);
  }
}

// Hosts download files attached to their own bookings and jobs.
export async function GET(request: NextRequest) {
  try {
    const { user } = await session();
    const file = (
      await getPool().query(
        "SELECT filename,content_type,data FROM private.intake_uploads WHERE id=$1 AND user_id=$2 AND (booking_id IS NOT NULL OR job_id IS NOT NULL)",
        [uuid(request.nextUrl.searchParams.get("id")), user.id],
      )
    ).rows[0];
    if (!file) throw new ApiError("File not found.", 404);
    return attachmentResponse(file, request.nextUrl.searchParams.get("inline") === "1");
  } catch (e) {
    return failure(e);
  }
}
