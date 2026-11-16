import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { ensureReferralCode, listReferrals } from "@/lib/referrals";
import { ApiError, body, failure, sameOrigin, session } from "@/lib/server";
import { usageOwner } from "@/lib/subscription-usage";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { token } = await session();
    const owner = await usageOwner(getPool(), token);
    const canManage = token === owner;
    return Response.json(
      { ...(await listReferrals(owner)), canManage },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token } = await session();
    const owner = await usageOwner(getPool(), token);
    if (token !== owner) {
      throw new ApiError("Only the workspace billing owner can manage referral codes.", 403);
    }
    const input = await body(request);
    const action = typeof input.action === "string" ? input.action : "ensure";
    if (action !== "ensure" && action !== "regenerate") {
      throw new ApiError("Invalid action.");
    }
    const regenerate = action === "regenerate";
    const code = await ensureReferralCode(owner, getPool(), regenerate);
    if (regenerate) {
      await getPool().query(
        "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'referral_code_regenerate',$2)",
        [owner, JSON.stringify({ code: code.code })],
      );
    }
    return Response.json(
      { ...(await listReferrals(owner)), canManage: true },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (e) {
    return failure(e);
  }
}
