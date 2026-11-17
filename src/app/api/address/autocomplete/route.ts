import { NextRequest } from "next/server";
import { allowRequest, clientIp } from "@/lib/booking-protection";
import { resolveAddressWorkspace } from "@/lib/address-workspace";
import { smartyAutocomplete } from "@/lib/smarty";
import { ApiError, failure, sameOriginBrowser, string } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    sameOriginBrowser(request);
    const ip = clientIp(request);
    if (!(await allowRequest("smarty-autocomplete", ip, 60, 60)))
      throw new ApiError("Too many address lookups. Please wait a moment.", 429);
    const host = string(request.nextUrl.searchParams.get("host") || "", "host", 80, 0);
    const { workspaceId } = await resolveAddressWorkspace({ host });
    const search = string(request.nextUrl.searchParams.get("search") || "", "search", 32, 0);
    const selected = string(request.nextUrl.searchParams.get("selected") || "", "selected", 200, 0);
    const result = await smartyAutocomplete({
      search,
      selected: selected || undefined,
      workspaceId,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
