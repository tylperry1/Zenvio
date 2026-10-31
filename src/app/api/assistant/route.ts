import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { ApiError, failure, sameOrigin, session, uuid } from "@/lib/server";
import { assistantAllowance } from "@/lib/assistant/limits";
import { assistantConfigured } from "@/lib/assistant/engine";
export const dynamic = "force-dynamic";

// Assistant status, conversation history, and one conversation with its actions.
export async function GET(request: NextRequest) {
  try {
    const { user } = await session();
    const pool = getPool();
    const id = request.nextUrl.searchParams.get("conversation");
    if (id) {
      const conversation = (
        await pool.query("SELECT id,title,created_at,updated_at FROM private.ai_conversations WHERE id=$1 AND user_id=$2", [
          uuid(id),
          user.id,
        ])
      ).rows[0];
      if (!conversation) throw new ApiError("Conversation not found.", 404);
      const [messages, actions] = await Promise.all([
        pool.query("SELECT id,role,content,tools,created_at FROM private.ai_messages WHERE conversation_id=$1 ORDER BY created_at", [id]),
        pool.query(
          `SELECT id,tool,preview,CASE WHEN status='pending' AND expires_at<=now() THEN 'expired' ELSE status END status,result,error,created_at
             FROM private.ai_actions WHERE conversation_id=$1 AND user_id=$2 ORDER BY created_at`,
          [id, user.id],
        ),
      ]);
      return Response.json(
        { conversation, messages: messages.rows, actions: actions.rows },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const [configured, allowance, conversations] = await Promise.all([
      assistantConfigured(),
      assistantAllowance(user.id),
      pool.query("SELECT id,title,updated_at FROM private.ai_conversations WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 50", [
        user.id,
      ]),
    ]);
    return Response.json(
      { configured, ...allowance, conversations: conversations.rows },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    sameOrigin(request);
    const { user } = await session();
    const id = uuid(request.nextUrl.searchParams.get("conversation"));
    const { rowCount } = await getPool().query("DELETE FROM private.ai_conversations WHERE id=$1 AND user_id=$2", [id, user.id]);
    if (!rowCount) throw new ApiError("Conversation not found.", 404);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
