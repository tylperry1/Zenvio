import { NextRequest } from "next/server";
import { clientIp } from "@/lib/booking-protection";
import { getPool } from "@/lib/db";
import { resolveViewChannel } from "@/lib/digital-identity";
import { recordProfileView, cleanCardDestination } from "@/lib/smart-cards";

export const dynamic = "force-dynamic";

function redirectTo(destination: string) {
  // Absolute Location URLs avoid empty-body relative 302 quirks on iOS Safari.
  // Resolve relative paths against the configured public origin — not request.url —
  // so self-hosted / mis-bound hosts never send phones to localhost.
  // Keep Cache-Control + Referrer-Policy — smart-cards tests and privacy require them.
  const publicOrigin = process.env.NEXT_PUBLIC_APP_URL || "https://gozenvio.com";
  const target = destination.startsWith("http")
    ? destination
    : new URL(destination, publicOrigin).toString();
  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

// Stable destination encoded on physical NFC/QR products. It always resolves
// through Zenvio so the owner can change, deactivate or reassign the card.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return redirectTo("/c/inactive");
  const card = (
    await getPool().query(
      `SELECT c.id card_id,c.status,c.destination_kind,c.destination_url,s.id profile_id,s.slug,s.published,p.slug booking_slug FROM private.smart_cards c
         LEFT JOIN private.smart_profiles s ON s.id=c.profile_id AND s.user_id=c.user_id LEFT JOIN public.profiles p ON p.id=c.user_id WHERE c.token=$1`,
      [token],
    )
  ).rows[0];
  if (!card || card.status !== "active" || !card.slug || !card.published)
    return redirectTo("/c/inactive");
  const channel = resolveViewChannel(request.nextUrl.searchParams.get("via"), request.nextUrl.searchParams.get("src"));
  // Default physical taps without src are card; NFC Studio programs ?src=nfc.
  const viewChannel = channel === "link" ? "card" : channel;
  await recordProfileView(card.profile_id, viewChannel, clientIp(request), { cardId: card.card_id }).catch(() => {});
  let destination = `/p/${card.slug}?via=${viewChannel === "nfc" ? "nfc" : "card"}`;
  if (card.destination_kind === "booking") {
    if (!card.booking_slug) return redirectTo("/c/inactive");
    destination = `/book/${card.booking_slug}?src=${viewChannel === "nfc" ? "nfc" : "smart-card"}`;
  } else if (card.destination_kind === "review" || card.destination_kind === "website") {
    try {
      destination = cleanCardDestination(card.destination_kind, card.destination_url).url;
    } catch {
      return redirectTo("/c/inactive");
    }
  }
  return redirectTo(destination);
}
