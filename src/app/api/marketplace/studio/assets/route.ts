import { NextRequest } from "next/server";
import { failure, sameOrigin, uuid, ApiError } from "@/lib/server";
import { shopper } from "@/lib/studio/shopper";
import { deleteAsset, listAssets, uploadAsset } from "@/lib/studio/service";
import { MAX_UPLOAD_BYTES } from "@/lib/studio/assets";
export const dynamic = "force-dynamic";
const owner = async (create = false) => {
  const s = await shopper({ create });
  return { userId: s.userId, guestHash: s.guestHash };
};
export async function GET() {
  try {
    return Response.json({ assets: await listAssets(await owner()) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const o = await owner(true);
    const limit = MAX_UPLOAD_BYTES + 64 * 1024;
    if (Number(request.headers.get("content-length") || 0) > limit) throw new ApiError("Upload a file up to 4 MB.", 413);
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError("Choose a file to upload.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new ApiError("Upload a file up to 4 MB.", 413);
      }
      chunks.push(value);
    }
    const form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new ApiError("Choose a file to upload.");
    const asset = await uploadAsset(o, Buffer.from(await file.arrayBuffer()), file.name || "artwork");
    return Response.json({ asset }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(request: NextRequest) {
  try {
    sameOrigin(request);
    await deleteAsset(await owner(), uuid(request.nextUrl.searchParams.get("id")));
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
