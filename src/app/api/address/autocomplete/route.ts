import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { allowRequest, clientIp } from "@/lib/booking-protection";
import { smartyAutocomplete } from "@/lib/smarty";
import { ApiError, failure, publicHostSlug, sameOriginBrowser, string } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    sameOriginBrowser(request);
    const ip = clientIp(request);
    if (!(await allowRequest("smarty-autocomplete", ip, 60, 60)))
      throw new ApiError("Too many address lookups. Please wait a moment.", 429);
    const host = publicHostSlug(
      request.nextUrl.searchParams.get("host") || "",
      "This booking page is unavailable.",
    );
    const search = string(request.nextUrl.searchParams.get("search") || "", "search", 32, 0);
    const selected = string(request.nextUrl.searchParams.get("selected") || "", "selected", 200, 0);
    const workspace = (
      await getPool().query("SELECT id FROM public.profiles WHERE slug=$1", [host])
    ).rows[0];
    if (!workspace) throw new ApiError("This booking page is unavailable.", 404);
    const result = await smartyAutocomplete({
      search,
      selected: selected || undefined,
      workspaceId: workspace.id,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
