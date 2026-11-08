import { NextRequest } from "next/server";
import { ApiError, body, failure, sameOrigin, session, uuid } from "@/lib/server";
import { allowRequest } from "@/lib/booking-protection";
import { customerConversations, customerReply, customerThread, customerUpdate, startConversation, supportAvailability } from "@/lib/support";
export const dynamic = "force-dynamic";
const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET(request: NextRequest) {
  try {
    const { user } = await session();
    const id = request.nextUrl.searchParams.get("conversation");
    if (id) return Response.json({ ...(await customerThread(user.id, id)), ...(await supportAvailability()) }, noStore);
    const [conversations, availability] = await Promise.all([customerConversations(user.id), supportAvailability()]);
    return Response.json({ conversations, ...availability, unread: conversations.reduce((n, c) => n + c.unread, 0) }, noStore);
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { user } = await session();
    const input = await body(request);
    if (!(await allowRequest("support-message", user.id, 60, 600))) throw new ApiError("You’re sending messages very quickly. Please wait a moment.", 429);
    if (input.conversation) {
      const id = uuid(input.conversation);
      if (input.action) await customerUpdate(user.id, id, input);
      else await customerReply(user.id, id, input.message);
      return Response.json({ ok: true });
    }
    if (!(await allowRequest("support-start", user.id, 6, 3600)))
      throw new ApiError("You’ve started several conversations recently. Please reply in an existing one.", 429);
    return Response.json({ id: await startConversation(user.id, input) }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
