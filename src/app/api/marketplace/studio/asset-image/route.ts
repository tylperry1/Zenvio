import { NextRequest } from "next/server";
import { failure, uuid } from "@/lib/server";
import { currentUser, shopper } from "@/lib/studio/shopper";
import { adminAccess, canAccess } from "@/lib/admin";
import { assetImage } from "@/lib/studio/service";
import sharp from "sharp";
export const dynamic = "force-dynamic";
// Private artwork: owner (or marketplace admin) only. ?size=preview returns a downscaled copy.
export async function GET(request: NextRequest) {
  try {
    const id = uuid(request.nextUrl.searchParams.get("id"));
    const user = await currentUser();
    const asAdmin = request.nextUrl.searchParams.get("admin") === "1" && user && canAccess(await adminAccess(user.id), "marketplace");
    let image: { image: Buffer; mime: string };
    if (asAdmin) image = await assetImage("admin", id);
    else {
      const s = await shopper();
      image = await assetImage({ userId: s.userId, guestHash: s.guestHash }, id);
    }
    const preview = request.nextUrl.searchParams.get("size") !== "full";
    const body = preview ? await sharp(image.image).resize(1200, 1200, { fit: "inside", withoutEnlargement: true }).png().toBuffer() : image.image;
    return new Response(new Uint8Array(body), {
      headers: { "Content-Type": preview ? "image/png" : image.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (e) {
    return failure(e);
  }
}
