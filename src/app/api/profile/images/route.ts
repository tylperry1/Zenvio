import { NextRequest } from "next/server";
import sharp from "sharp";
import { getPool } from "@/lib/db";
import { ApiError, failure, sameOrigin, session, slug } from "@/lib/server";
import { readUpload } from "@/lib/uploads";
export const dynamic = "force-dynamic";

const sizes = { cover: { width: 1600, height: 500, fit: "cover" as const }, logo: { width: 400, height: 400, fit: "inside" as const } };
function kind(value: string | null) {
  if (value !== "cover" && value !== "logo") throw new ApiError("Choose a cover image or logo.");
  return value;
}

export async function GET(request: NextRequest) {
  try {
    const host = slug(request.nextUrl.searchParams.get("host"));
    const { rows } = await getPool().query(
      "SELECT i.image FROM private.profile_images i JOIN public.profiles p ON p.id=i.user_id WHERE p.slug=$1 AND i.kind=$2",
      [host, kind(request.nextUrl.searchParams.get("kind"))],
    );
    if (!rows[0]) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(rows[0].image), {
      headers: { "Content-Type": "image/webp", "Cache-Control": "public,max-age=60", "X-Content-Type-Options": "nosniff" },
    });
  } catch (e) {
    return failure(e);
  }
}

// Images are decoded and re-encoded as WebP, which validates the file and strips metadata.
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { user } = await session();
    const k = kind(request.nextUrl.searchParams.get("kind"));
    const source = await readUpload(request, 4000000, "image");
    let image: Buffer;
    try {
      const meta = await sharp(source, { limitInputPixels: 40000000 }).metadata();
      if (!["jpeg", "png", "webp"].includes(meta.format || "")) throw Error("unsupported");
      const size = sizes[k];
      image = await sharp(source, { limitInputPixels: 40000000, animated: false })
        .rotate()
        .resize(size.width, size.height, { fit: size.fit, withoutEnlargement: true })
        .webp({ quality: k === "logo" ? 90 : 80 })
        .toBuffer();
    } catch {
      throw new ApiError("Use a valid JPEG, PNG, or WebP image.");
    }
    await getPool().query(
      "INSERT INTO private.profile_images(user_id,kind,image) VALUES($1,$2,$3) ON CONFLICT(user_id,kind) DO UPDATE SET image=$3,updated_at=now()",
      [user.id, k, image],
    );
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    sameOrigin(request);
    const { user } = await session();
    await getPool().query("DELETE FROM private.profile_images WHERE user_id=$1 AND kind=$2", [user.id, kind(request.nextUrl.searchParams.get("kind"))]);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
