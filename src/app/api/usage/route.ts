import { session, failure } from "@/lib/server";
import { entitlementUsage } from "@/lib/entitlements";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const { token } = await session();
    return Response.json(await entitlementUsage(token), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
