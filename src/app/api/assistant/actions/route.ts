import {assistantPolicy} from "@/lib/assistant/limits";
import {aiConfiguration} from "@/lib/launch/provider-policy";
import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { ApiError, body, failure, sameOrigin, session, uuid } from "@/lib/server";
import { allowRequest } from "@/lib/booking-protection";
import { assistantContext } from "@/lib/assistant/context";
import { runApprovedAction } from "@/lib/assistant/tools";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Approve or reject an action the assistant prepared. The action runs only here, for its owner,
// once; the outcome reported is what the backend returned.
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { user } = await session();
    const input = await body(request);
    const id = uuid(input.id);
    const decision = input.decision;
    if (decision !== "approve" && decision !== "reject") throw new ApiError("Choose approve or reject.");
    if (!(await allowRequest("assistant-action", user.id, 20, 60)))
      throw new ApiError("Too many requests. Please wait and try again.", 429);
    const pool = getPool();
    if (decision === "reject") {
      const { rows } = await pool.query(
        "UPDATE private.ai_actions SET status='rejected',decided_at=now() WHERE id=$1 AND user_id=$2 AND status='pending' RETURNING conversation_id,preview",
        [id, user.id],
      );
      if (!rows[0]) throw new ApiError("This action is no longer waiting for approval.", 409);
      await note(rows[0].conversation_id, `[Action outcome] The user declined: ${rows[0].preview.title}.`);
      return Response.json({ status: "rejected" });
    }
    if(!(await assistantPolicy()).enabled||!(await aiConfiguration()).enabled)throw new ApiError("Assistant actions are suspended by the platform administrator.",403);
    await pool.query(
      "UPDATE private.ai_actions SET status='expired' WHERE id=$1 AND user_id=$2 AND status='pending' AND expires_at<=now()",
      [id, user.id],
    );
    const claimed = (
      await pool.query(
        "UPDATE private.ai_actions SET status='approved',decided_at=now() WHERE id=$1 AND user_id=$2 AND status='pending' RETURNING tool,input,preview,conversation_id",
        [id, user.id],
      )
    ).rows[0];
    if (!claimed) {
      const current = (await pool.query("SELECT status FROM private.ai_actions WHERE id=$1 AND user_id=$2", [id, user.id])).rows[0];
      if (!current) throw new ApiError("Action not found.", 404);
      throw new ApiError(
        current.status === "expired"
          ? "This approval expired. Ask the assistant to prepare it again."
          : "This action was already handled.",
        409,
      );
    }
    const ctx = await assistantContext(user);
    try {
      const outcome = await runApprovedAction(ctx, claimed.tool, claimed.input);
      await pool.query(
        "UPDATE private.ai_actions SET status='succeeded',result=$2,completed_at=now() WHERE id=$1",
        [id, JSON.stringify(outcome)],
      );
      await note(claimed.conversation_id, `[Action outcome] Completed: ${outcome.message}`);
      return Response.json({ status: "succeeded", message: outcome.message, data: outcome.data ?? null });
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "The action couldn’t be completed. Nothing was changed.";
      if (!(e instanceof ApiError)) console.error("Approved action failed", claimed.tool, e instanceof Error ? e.name : "UnknownError");
      await pool.query("UPDATE private.ai_actions SET status='failed',error=$2,completed_at=now() WHERE id=$1", [id, message]);
      await note(claimed.conversation_id, `[Action outcome] Failed: ${claimed.preview.title}. ${message}`);
      return Response.json({ status: "failed", error: message }, { status: e instanceof ApiError ? e.status : 500 });
    }
  } catch (e) {
    return failure(e);
  }
}

async function note(conversationId: string | null, text: string) {
  if (conversationId)
    await getPool().query("INSERT INTO private.ai_messages(conversation_id,role,content) VALUES($1,'assistant',$2)", [
      conversationId,
      text,
    ]);
}
