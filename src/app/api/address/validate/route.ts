import { NextRequest } from "next/server";
import { allowRequest, clientIp } from "@/lib/booking-protection";
import { resolveAddressWorkspace } from "@/lib/address-workspace";
import { parseAddressInput } from "@/lib/addresses";
import { smartyValidateAddress } from "@/lib/smarty";
import { ApiError, body, failure, sameOrigin, string } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const ip = clientIp(request);
    if (!(await allowRequest("smarty-validate", ip, 30, 60)))
      throw new ApiError("Too many validation attempts. Please wait a moment.", 429);
    const input = await body(request);
    const host = string(String(input.host || ""), "host", 80, 0);
    const { workspaceId } = await resolveAddressWorkspace({ host });
    const result = await smartyValidateAddress({
      address: parseAddressInput(input.address),
      workspaceId,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
