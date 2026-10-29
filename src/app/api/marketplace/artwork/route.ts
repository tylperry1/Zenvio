import { NextRequest } from "next/server";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { getPool } from "@/lib/db";
import { session, sameOrigin, failure, uuid, ApiError } from "@/lib/server";
import { platformRole } from "@/lib/admin";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    const { token } = await session(),
      id = uuid(req.nextUrl.searchParams.get("id")),
      admin = (await platformRole(token)) === "master_admin";
    const r = (
      await getPool().query(
        "SELECT image FROM private.marketplace_artwork WHERE id=$1" +
          (admin ? "" : " AND user_id=$2"),
        admin ? [id] : [id, token],
      )
    ).rows[0];
    if (!r) throw new ApiError("Artwork not found.", 404);
    return new Response(r.image, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    sameOrigin(req);
    const { token } = await session();
    if (Number(req.headers.get("content-length") || 0) > 2100000)
      throw new ApiError("Use an image smaller than 2 MB.", 413);
    const reader = req.body?.getReader();
    if (!reader) throw new ApiError("Upload an image.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2100000) {
        await reader.cancel();
        throw new ApiError("Use an image smaller than 2 MB.", 413);
      }
      chunks.push(value);
    }
    const form = await new Response(Buffer.concat(chunks), {
        headers: { "Content-Type": req.headers.get("content-type") || "" },
      }).formData(),
      file = form.get("image");
    if (!(file instanceof File) || file.size > 2000000)
      throw new ApiError("Upload JPEG, PNG, or WebP artwork under 2 MB.");
    const input = Buffer.from(await file.arrayBuffer()),
      meta = await sharp(input, { limitInputPixels: 16000000 }).metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format || ""))
      throw new ApiError("Use JPEG, PNG, or WebP artwork.");
    const image = await sharp(input, { limitInputPixels: 16000000 })
      .rotate()
      .resize({
        width: 2048,
        height: 2048,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    if (image.length > 2000000)
      throw new ApiError(
        "The processed image is too large. Reduce its dimensions.",
      );
    const d = await sharp(image).metadata();
    const db = await getPool().connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "artwork:" + token,
      ]);
      const count = (
        await db.query(
          "SELECT count(*)::int n FROM private.marketplace_artwork WHERE user_id=$1 AND created_at>now()-interval '1 day'",
          [token],
        )
      ).rows[0].n;
      if (count >= 10)
        throw new ApiError("Daily artwork upload limit reached.", 429);
      const r = await db.query(
        "INSERT INTO private.marketplace_artwork(user_id,image,sha256,width,height) VALUES($1,$2,$3,$4,$5) RETURNING id",
        [
          token,
          image,
          createHash("sha256").update(image).digest("hex"),
          d.width,
          d.height,
        ],
      );
      await db.query("COMMIT");
      return Response.json(r.rows[0], { status: 201 });
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  } catch (e) {
    return failure(e);
  }
}
