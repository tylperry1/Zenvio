import { NextRequest } from "next/server";
import { failure, uuid } from "@/lib/server";
import { currentUser, shopper } from "@/lib/studio/shopper";
import { adminAccess, canAccess } from "@/lib/admin";
import { proofFile } from "@/lib/studio/service";
export const dynamic = "force-dynamic";
// The exact production file that will be sent to the supplier for this design revision.
export async function GET(request: NextRequest) {
  try {
    const id = uuid(request.nextUrl.searchParams.get("id"));
    const user = await currentUser();
    const asAdmin = request.nextUrl.searchParams.get("admin") === "1" && user && canAccess(await adminAccess(user.id), "marketplace");
    let proof;
    if (asAdmin) proof = await proofFile("admin", id);
    else {
      const s = await shopper();
      proof = await proofFile({ userId: s.userId, guestHash: s.guestHash }, id);
    }
    return new Response(new Uint8Array(proof.file), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="zenvio-proof-${proof.area}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
