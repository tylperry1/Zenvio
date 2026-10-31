import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError } from "./server";

// Files guests attach to a booking form or service request before submitting it. Each upload
// is tied to the host and to a random key held by the guest's browser; only the same key can
// attach it to the booking or job it creates. Unclaimed uploads are deleted after a day.
export const uploadKeyHash = (key: string) => createHash("sha256").update("upload:" + key).digest("hex");

export function uploadKey(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9-]{32,64}$/.test(value)) throw new ApiError("Invalid upload session.");
  return value;
}

export async function claimUploads(
  db: PoolClient,
  input: { hostId: string; ids: string[]; key: string; bookingId?: string; jobId?: string },
) {
  if (!input.ids.length) return [];
  const { rows } = await db.query(
    `UPDATE private.intake_uploads SET booking_id=$4,job_id=$5
      WHERE id=ANY($1::uuid[]) AND user_id=$2 AND upload_key_hash=$3 AND booking_id IS NULL AND job_id IS NULL
      RETURNING id,filename`,
    [input.ids, input.hostId, uploadKeyHash(input.key), input.bookingId || null, input.jobId || null],
  );
  if (rows.length !== new Set(input.ids).size) throw new ApiError("An attached file expired. Please attach it again.", 409);
  return rows as { id: string; filename: string }[];
}

export async function purgeUnclaimedUploads(db: { query: PoolClient["query"] }) {
  await db.query("DELETE FROM private.intake_uploads WHERE booking_id IS NULL AND job_id IS NULL AND created_at<now()-interval '1 day'");
}
