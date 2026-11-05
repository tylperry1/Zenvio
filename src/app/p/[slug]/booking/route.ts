import type { NextRequest } from "next/server";
import { clientIp } from "@/lib/booking-protection";
import { loadPublicProfile, recordProfileAction } from "@/lib/smart-cards";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const profile = await loadPublicProfile((await params).slug.toLowerCase());
  if (!profile?.view.bookingUrl) return new Response("Not found", { status: 404 });
  await recordProfileAction(profile.id, "booking", clientIp(request)).catch(() => {});
  return new Response(null, {
    status: 302,
    headers: { Location: profile.view.bookingUrl, "Cache-Control": "no-store" },
  });
}
