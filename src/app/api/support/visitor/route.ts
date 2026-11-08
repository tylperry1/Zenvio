import { after, type NextRequest } from "next/server";
import { deliverSupportNotifications } from "@/lib/support-notify";
import { failure } from "@/lib/server";
import { visitorGet, visitorPost } from "@/lib/support-visitor";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

// Public chat for website visitors without an account.
export async function GET(request: NextRequest) {
  try {
    return Response.json(await visitorGet(request), { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { data, cookie, status } = await visitorPost(request);
    after(() => deliverSupportNotifications().then(() => {}, () => {}));
    const headers = new Headers(noStore);
    if (cookie) headers.append("Set-Cookie", cookie);
    return Response.json(data, { status: status ?? 200, headers });
  } catch (error) {
    return failure(error);
  }
}
