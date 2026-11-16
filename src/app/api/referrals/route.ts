import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { ensureReferralCode, listReferrals } from "@/lib/referrals";
import { ApiError, body, failure, sameOrigin, session } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { token } = await session();
    return Response.json(await listReferrals(token), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { token } = await session();
    const input = await body(request);
    const action = typeof input.action === "string" ? input.action : "ensure";
    if (action !== "ensure" && action !== "regenerate") {
      throw new ApiError("Invalid action.");
    }
    const regenerate = action === "regenerate";
    const code = await ensureReferralCode(token, getPool(), regenerate);
    if (regenerate) {
      await getPool().query(
        "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'referral_code_regenerate',$2)",
        [token, JSON.stringify({ code: code.code })],
      );
    }
    return Response.json(await listReferrals(token), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
