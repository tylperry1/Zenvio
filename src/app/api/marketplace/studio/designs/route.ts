import { NextRequest } from "next/server";
import { body, failure, integer, sameOrigin, ApiError } from "@/lib/server";
import { shopper } from "@/lib/studio/shopper";
import { approveDesign, claimGuestWork, getDesign, listDesigns, saveDesign } from "@/lib/studio/service";
import { cookies } from "next/headers";
import { hashToken } from "@/lib/studio/shopper";
export const dynamic = "force-dynamic";
async function owner(create = false) {
  const s = await shopper({ create });
  if (s.kind === "user") {
    // Work started as a guest moves into the account after sign-in.
    const t = (await cookies()).get("zv_studio")?.value;
    if (t && /^[A-Za-z0-9_-]{43}$/.test(t)) await claimGuestWork(s.userId, hashToken(t));
  }
  return { userId: s.userId, guestHash: s.guestHash };
}
export async function GET(request: NextRequest) {
  try {
    const o = await owner();
    const id = request.nextUrl.searchParams.get("id");
    return Response.json(id ? { design: await getDesign(o, id) } : { designs: await listDesigns(o) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const input = await body(request);
    const o = await owner(true);
    if (input.action === "save")
      return Response.json({ design: await saveDesign(o, { id: input.id, productId: input.productId, variantId: input.variantId, name: input.name, config: input.config }) });
    if (input.action === "approve") {
      if (input.confirm !== true) throw new ApiError("Confirm that you reviewed the proof before approving.");
      return Response.json({ design: await approveDesign(o, String(input.id), integer(input.revision, "design revision", 0, 1000000)) });
    }
    throw new ApiError("Unknown design action.");
  } catch (e) {
    return failure(e);
  }
}
