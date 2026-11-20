import type { NextRequest } from "next/server";
import { clientIp } from "@/lib/booking-protection";
import { PROFILE_ACTIONS, resolveViewChannel, type ProfileAction } from "@/lib/digital-identity";
import { loadPublicProfile, recordProfileAction } from "@/lib/smart-cards";

export const dynamic = "force-dynamic";

/** Record outbound profile clicks (phone/email/website/social/share/copy) without inventing conversions. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const profile = await loadPublicProfile((await params).slug.toLowerCase());
  if (!profile) return Response.json({ error: "Not found" }, { status: 404 });
  let body: { action?: string; via?: string; href?: string } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const action = String(body.action || "");
  if (!(PROFILE_ACTIONS as readonly string[]).includes(action) || action === "vcard" || action === "booking") {
    return Response.json({ error: "Unsupported action" }, { status: 400 });
  }
  await recordProfileAction(profile.id, action as ProfileAction, clientIp(request), {
    channel: resolveViewChannel(body.via ?? request.nextUrl.searchParams.get("via"), request.nextUrl.searchParams.get("src")),
  }).catch(() => {});
  return Response.json({ ok: true });
}
