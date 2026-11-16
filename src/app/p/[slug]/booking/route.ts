import type { NextRequest } from "next/server";
import { clientIp } from "@/lib/booking-protection";
import { platformOrigin } from "@/lib/transactional-email";
import { loadPublicProfile, recordProfileAction } from "@/lib/smart-cards";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const profile = await loadPublicProfile((await params).slug.toLowerCase());
  if (!profile?.view.bookingUrl) return new Response("Not found", { status: 404 });
  await recordProfileAction(profile.id, "booking", clientIp(request)).catch(() => {});
  const location = new URL(profile.view.bookingUrl, platformOrigin()).href;
  return new Response(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}
