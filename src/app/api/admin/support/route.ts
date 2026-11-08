import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { adminSession } from "@/lib/admin";
import { ApiError, body, failure, sameOrigin, uuid } from "@/lib/server";
import {
  agentHeartbeat,
  deleteSavedReply,
  messageToSuggestion,
  savedReplies,
  saveReply,
  staffReply,
  staffThread,
  staffUpdate,
  supportQueue,
} from "@/lib/support";
export const dynamic = "force-dynamic";
const noStore = { headers: { "Cache-Control": "no-store" } };

async function audit(actor: string, action: string, details: Record<string, unknown>) {
  await getPool().query("INSERT INTO private.admin_audit_log(actor_id,action,details) VALUES($1,$2,$3)", [actor, action, JSON.stringify(details)]);
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await adminSession("support");
    const p = request.nextUrl.searchParams;
    const id = p.get("conversation");
    if (id) return Response.json(await staffThread(id), noStore);
    const [queue, replies, available] = await Promise.all([
      supportQueue(user.id, {
        view: p.get("view") || "all",
        status: p.get("status") || "active",
        search: p.get("q") || "",
        category: p.get("category") || "",
      }),
      savedReplies(),
      agentHeartbeat(user.id),
    ]);
    return Response.json({ ...queue, replies, available, me: user.id }, noStore);
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { user } = await adminSession("support");
    const input = await body(request);
    switch (input.action) {
      case "reply":
        await staffReply(user.id, uuid(input.conversation), input);
        break;
      case "update": {
        const id = uuid(input.conversation);
        await staffUpdate(id, input);
        await audit(user.id, "support_update", {
          conversation: id,
          ...(input.status !== undefined && { status: input.status }),
          ...(input.priority !== undefined && { priority: input.priority }),
          ...(input.assignee !== undefined && { assignee: input.assignee || null }),
        });
        break;
      }
      case "suggestion": {
        const feedback = await messageToSuggestion(uuid(input.message));
        await audit(user.id, "support_suggestion", { message: input.message, feedback });
        return Response.json({ ok: true, feedback });
      }
      case "availability":
        return Response.json({ available: await agentHeartbeat(user.id, input.available === true) });
      case "save-reply":
        await saveReply(user.id, input);
        break;
      case "delete-reply":
        await deleteSavedReply(uuid(input.id));
        break;
      default:
        throw new ApiError("Unknown action.");
    }
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
