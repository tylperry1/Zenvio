import type { NextRequest } from "next/server";
import { clientIp } from "@/lib/booking-protection";
import { resolveViewChannel } from "@/lib/digital-identity";
import { publicShareUrl } from "@/lib/share";
import { loadPublicProfile, recordProfileAction } from "@/lib/smart-cards";

export const dynamic = "force-dynamic";

/** Map Digital Identity view channels onto booking_sources `src` values. */
function bookingSourceParam(channel: ReturnType<typeof resolveViewChannel>) {
  if (channel === "nfc") return "nfc";
  if (channel === "qr") return "qr";
  // card / link (default) preserve the existing smart-card conversion label
  return "smart-card";
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const profile = await loadPublicProfile((await params).slug.toLowerCase());
  if (!profile?.view.bookingUrl) return new Response("Not found", { status: 404 });
  const channel = resolveViewChannel(request.nextUrl.searchParams.get("via"), request.nextUrl.searchParams.get("src"));
  await recordProfileAction(profile.id, "booking", clientIp(request), { channel }).catch(() => {});
  const destination = new URL(profile.view.bookingUrl, request.nextUrl.origin);
  destination.searchParams.set("src", bookingSourceParam(channel));
  const location = publicShareUrl(`${destination.pathname}${destination.search}`, request.nextUrl.origin);
  return new Response(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}
