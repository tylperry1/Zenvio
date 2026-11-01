import { NextRequest } from "next/server";
import { clientIp } from "@/lib/booking-protection";
import { getPool } from "@/lib/db";
import { recordProfileView } from "@/lib/smart-cards";

export const dynamic = "force-dynamic";

// Stable destination encoded on physical NFC/QR products. It always resolves
// through Zenvio so the owner can change, deactivate or reassign the card.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return Response.redirect(new URL("/c/inactive", request.url), 302);
  const card = (
    await getPool().query(
      `SELECT c.status,s.id profile_id,s.slug,s.published FROM private.smart_cards c
         LEFT JOIN private.smart_profiles s ON s.id=c.profile_id WHERE c.token=$1`,
      [token],
    )
  ).rows[0];
  if (!card || card.status !== "active" || !card.slug || !card.published)
    return new Response(null, { status: 302, headers: { ...headers, Location: "/c/inactive" } });
  await recordProfileView(card.profile_id, "card", clientIp(request)).catch(() => {});
  return new Response(null, { status: 302, headers: { ...headers, Location: `/p/${card.slug}?via=card` } });
}
