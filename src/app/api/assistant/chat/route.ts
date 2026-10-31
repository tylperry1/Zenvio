import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { ApiError, body, failure, sameOrigin, session, string, uuid } from "@/lib/server";
import { allowRequest } from "@/lib/booking-protection";
import { requireAllowance } from "@/lib/assistant/limits";
import { assistantContext, pageContext } from "@/lib/assistant/context";
import { conversationTitle, runAssistantTurn, type AssistantEvent } from "@/lib/assistant/engine";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Streams one assistant turn as server-sent events.
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { user } = await session();
    const input = await body(request);
    const text = string(input.message, "message", 4000);
    if (!(await allowRequest("assistant", user.id, 12, 60)))
      throw new ApiError("You’re sending messages quickly. Wait a moment and try again.", 429);
    await requireAllowance(user.id);
    const ctx = await assistantContext(user);
    const pool = getPool();
    let conversationId: string;
    if (input.conversationId) {
      conversationId = uuid(input.conversationId);
      const owned = await pool.query("UPDATE private.ai_conversations SET updated_at=now() WHERE id=$1 AND user_id=$2", [
        conversationId,
        user.id,
      ]);
      if (!owned.rowCount) throw new ApiError("Conversation not found.", 404);
    } else {
      conversationId = (
        await pool.query("INSERT INTO private.ai_conversations(user_id,title) VALUES($1,$2) RETURNING id", [
          user.id,
          conversationTitle(text),
        ])
      ).rows[0].id;
    }
    const context = await pageContext(user.id, input.context);
    await pool.query("INSERT INTO private.ai_messages(conversation_id,role,content) VALUES($1,'user',$2)", [
      conversationId,
      text,
    ]);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (event: AssistantEvent) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {}
        };
        emit({ type: "conversation", id: conversationId });
        try {
          const result = await runAssistantTurn(ctx, { conversationId, text, context }, emit);
          if (result.reply.trim() || result.tools.length)
            await pool.query("INSERT INTO private.ai_messages(conversation_id,role,content,tools) VALUES($1,'assistant',$2,$3)", [
              conversationId,
              result.reply.slice(0, 40000) || "(Prepared actions for review.)",
              JSON.stringify(result.tools),
            ]);
        } catch (e) {
          const known = e instanceof ApiError;
          const status = (e as { status?: number }).status;
          if (!known) console.error("Assistant turn failed", e instanceof Error ? e.name : "UnknownError");
          emit({
            type: "error",
            message: known
              ? e.message
              : status === 429 || status === 529
                ? "The assistant is busy right now. Try again in a moment."
                : "The assistant couldn’t finish that response. Try again.",
            retryable: !known || e.status >= 500,
          });
        }
        emit({ type: "done" });
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
