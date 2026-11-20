import { NextRequest } from "next/server";
import { clientIp } from "@/lib/booking-protection";
import { getPool } from "@/lib/db";
import { recordProfileView, cleanCardDestination } from "@/lib/smart-cards";

export const dynamic = "force-dynamic";

function redirectTo(request: NextRequest, destination: string) {
  // Absolute Location URLs avoid empty-body relative 302 quirks on iOS Safari.
  // Keep Cache-Control + Referrer-Policy — smart-cards tests and privacy require them.
  const target = destination.startsWith("http")
    ? destination
    : new URL(destination, request.url).toString();
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
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return redirectTo(request, "/c/inactive");
  const card = (
    await getPool().query(
      `SELECT c.status,c.destination_kind,c.destination_url,s.id profile_id,s.slug,s.published,p.slug booking_slug FROM private.smart_cards c
         LEFT JOIN private.smart_profiles s ON s.id=c.profile_id AND s.user_id=c.user_id LEFT JOIN public.profiles p ON p.id=c.user_id WHERE c.token=$1`,
      [token],
    )
  ).rows[0];
  if (!card || card.status !== "active" || !card.slug || !card.published)
    return redirectTo(request, "/c/inactive");
  await recordProfileView(card.profile_id, "card", clientIp(request)).catch(() => {});
  let destination = `/p/${card.slug}?via=card`;
  if (card.destination_kind === "booking") {
    if (!card.booking_slug) return redirectTo(request, "/c/inactive");
    destination = `/book/${card.booking_slug}?src=nfc`;
  } else if (card.destination_kind === "review" || card.destination_kind === "website") {
    try {
      destination = cleanCardDestination(card.destination_kind, card.destination_url).url;
    } catch {
      return redirectTo(request, "/c/inactive");
    }
  }
  return redirectTo(request, destination);
}
