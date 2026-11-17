import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { allowRequest, clientIp } from "@/lib/booking-protection";
import { parseAddressInput } from "@/lib/addresses";
import { smartyValidateAddress } from "@/lib/smarty";
import { ApiError, body, failure, publicHostSlug, sameOrigin } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const ip = clientIp(request);
    if (!(await allowRequest("smarty-validate", ip, 30, 60)))
      throw new ApiError("Too many validation attempts. Please wait a moment.", 429);
    const input = await body(request);
    const host = publicHostSlug(String(input.host || ""), "This booking page is unavailable.");
    const workspace = (
      await getPool().query("SELECT id FROM public.profiles WHERE slug=$1", [host])
    ).rows[0];
    if (!workspace) throw new ApiError("This booking page is unavailable.", 404);
    const result = await smartyValidateAddress({
      address: parseAddressInput(input.address),
      workspaceId: workspace.id,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
