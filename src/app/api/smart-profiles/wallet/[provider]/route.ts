import type { NextRequest } from "next/server";
import { allowRequest } from "@/lib/booking-protection";
import { getPool } from "@/lib/db";
import { ApiError, failure, sameOrigin, session, uuid } from "@/lib/server";
import { publicView } from "@/lib/smart-cards";
import { appleWalletPass, googleWalletSaveUrl, walletFlags, walletProfileUrl } from "@/lib/smart-wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  try {
    sameOrigin(request);
    const { token: owner } = await session();
    const { provider } = await params;
    if ((provider !== "apple" && provider !== "google") || !walletFlags()[provider]) {
      throw new ApiError("This Wallet provider is unavailable.", 404);
    }
    const id = uuid(request.nextUrl.searchParams.get("id"));
    if (!(await allowRequest("smart-wallet", `${owner}:${provider}`, 12, 3600))) {
      throw new ApiError("Too many Wallet requests. Try again later.", 429);
    }
    const { rows } = await getPool().query(
      "SELECT * FROM private.smart_profiles WHERE id=$1 AND user_id=$2 AND published AND archived_at IS NULL",
      [id, owner],
    );
    if (!rows[0]) throw new ApiError("Published profile not found.", 404);
    const view = publicView(rows[0], null);
    const card = { ...view, id };
    const url = walletProfileUrl(view.slug);
    try {
      if (provider === "google") {
        const saveUrl = await googleWalletSaveUrl(card, url);
        return Response.json({ saveUrl }, { headers: { "Cache-Control": "no-store" } });
      }
      const pass = await appleWalletPass(card, url);
      return new Response(Uint8Array.from(pass), {
        headers: {
          "Content-Type": "application/vnd.apple.pkpass",
          "Content-Disposition": `attachment; filename="${view.slug}.pkpass"`,
          "Cache-Control": "no-store",
        },
      });
    } catch {
      // Provider errors can contain request headers or credential material.
      throw new ApiError("Unable to create the Wallet pass. Please try again later.", 503);
    }
  } catch (error) {
    return failure(error);
  }
}
