import { NextRequest } from "next/server";
import { ApiError, backend, failure, slug } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const host = slug(request.nextUrl.searchParams.get("host"));
    const profile = await backend("/rest/v1/rpc/public_profile", {
      method: "POST",
      body: JSON.stringify({ host_slug: host }),
    });
    if (!profile)
      throw new ApiError("This booking profile is unavailable.", 404);
    return Response.json(profile, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
