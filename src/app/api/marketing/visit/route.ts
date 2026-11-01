import { NextRequest } from "next/server";
import { allowRequest, clientIp } from "@/lib/booking-protection";
import { getPool } from "@/lib/db";
import { cleanAttribution, recordPageView } from "@/lib/marketing";
import { body, failure, sameOrigin } from "@/lib/server";

export const dynamic = "force-dynamic";

// Counts a booking-page view per source. Aggregate only: no visitor identifiers are stored.
export async function POST(request: NextRequest) {
  try {
    try {
      sameOrigin(request);
    } catch {
      return new Response(null, { status: 204 });
    }
    const input = await body(request);
    const host = typeof input.host === "string" ? input.host.toLowerCase().slice(0, 80) : "";
    if (!/^[a-z0-9-]{1,80}$/.test(host) || host === "demo") return new Response(null, { status: 204 });
    // Throttle per client and page so counts can't be trivially inflated.
    if (!(await allowRequest("booking-view", `${clientIp(request)}:${host}`, 20, 3600))) return new Response(null, { status: 204 });
    const owner = (await getPool().query("SELECT id FROM public.profiles WHERE slug=$1", [host])).rows[0];
    if (owner) await recordPageView(owner.id, cleanAttribution(input.attribution).source);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
