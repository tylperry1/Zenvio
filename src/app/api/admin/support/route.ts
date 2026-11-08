import { after, type NextRequest } from "next/server";
import { deliverSupportNotifications } from "@/lib/support-notify";
import { failure } from "@/lib/server";
import { supportGet, supportPost } from "@/lib/support";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try { return Response.json(await supportGet(request, true), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const result = await supportPost(request, true);
    after(() => deliverSupportNotifications().then(() => {}, () => {}));
    return Response.json(result);
  }
  catch (error) { return failure(error); }
}
