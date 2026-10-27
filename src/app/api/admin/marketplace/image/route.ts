import { NextRequest } from "next/server";
import sharp from "sharp";
import { adminSession } from "@/lib/admin";
import { getPool } from "@/lib/db";
import { sameOrigin, failure, uuid, ApiError } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    await adminSession();
    const { rows } = await getPool().query(
      "SELECT image FROM private.marketplace_products WHERE id=$1",
      [uuid(request.nextUrl.searchParams.get("product"))],
    );
    if (!rows[0]?.image) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(rows[0].image), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private,no-store",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token } = await adminSession(),
      id = uuid(request.nextUrl.searchParams.get("product"));
    if (Number(request.headers.get("content-length")) > 2000000)
      throw new ApiError("Choose an image under 2 MB.", 413);
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError("Choose an image.");
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2000000) {
        await reader.cancel();
        throw new ApiError("Choose an image under 2 MB.", 413);
      }
      chunks.push(value);
    }
    let image;
    try {
      const source = Buffer.concat(chunks),
        metadata = await sharp(source, {
          limitInputPixels: 20000000,
        }).metadata();
      if (!["jpeg", "png", "webp"].includes(metadata.format || ""))
        throw Error();
      image = await sharp(source, { limitInputPixels: 20000000 })
        .rotate()
        .resize(1000, 1000, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
    } catch {
      throw new ApiError("Choose a valid JPEG, PNG, or WebP image.");
    }
    const r = await getPool().query(
      "UPDATE private.marketplace_products SET image=$2,updated_at=now(),revision=revision+1 WHERE id=$1 RETURNING id",
      [id, image],
    );
    if (!r.rowCount) throw new ApiError("Product not found.", 404);
    await getPool().query(
      "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,$2,$3)",
      [token, "marketplace_product_image", JSON.stringify({ productId: id })],
    );
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
