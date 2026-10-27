import { NextRequest } from "next/server";
import sharp from "sharp";
import { getPool } from "@/lib/db";
import { session, sameOrigin, failure, ApiError, slug } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const host = slug(request.nextUrl.searchParams.get("host"));
    const { rows } = await getPool().query(
      "SELECT ph.image FROM private.profile_photos ph JOIN public.profiles p ON p.id=ph.user_id WHERE p.slug=$1",
      [host],
    );
    if (!rows[0]) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(rows[0].image), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public,max-age=60",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token } = await session();
    if (Number(request.headers.get("content-length")) > 2100000)
      throw new ApiError("Choose a photo under 2 MB.", 413);
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError("Choose a photo.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2000000) {
        await reader.cancel();
        throw new ApiError("Choose a photo under 2 MB.", 413);
      }
      chunks.push(value);
    }
    let image: Buffer;
    try {
      const source = Buffer.concat(chunks);
      const metadata = await sharp(source, {
        limitInputPixels: 20000000,
      }).metadata();
      if (!["jpeg", "png", "webp"].includes(metadata.format || ""))
        throw Error("Unsupported image");
      image = await sharp(source, {
        limitInputPixels: 20000000,
        animated: false,
      })
        .rotate()
        .resize(512, 512, { fit: "cover", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw new ApiError("Use a valid JPEG, PNG, or WebP photo.");
    }
    await getPool().query(
      "INSERT INTO private.profile_photos(user_id,image) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET image=$2,updated_at=now()",
      [token, image],
    );
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token } = await session();
    await getPool().query(
      "DELETE FROM private.profile_photos WHERE user_id=$1",
      [token],
    );
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
