import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { adminSession } from "@/lib/admin";
import { ApiError, body, email, failure, integer, sameOrigin, uuid } from "@/lib/server";
import { assistantPolicy } from "@/lib/assistant/limits";
import { assistantConfigured } from "@/lib/assistant/engine";
export const dynamic = "force-dynamic";

// Platform-wide assistant switch and limits, per-account overrides, usage and the action audit trail.
export async function GET() {
  try {
    await adminSession();
    const pool = getPool();
    const [policy, configured, usage, top, overrides, actions] = await Promise.all([
      assistantPolicy(),
      assistantConfigured(),
      pool.query(
        `SELECT day,sum(requests)::int requests,sum(input_tokens)::bigint input_tokens,sum(output_tokens)::bigint output_tokens,count(*)::int users
           FROM private.ai_usage WHERE day>=current_date-29 GROUP BY day ORDER BY day`,
      ),
      pool.query(
        `SELECT u.id,u.name,u.email,sum(a.requests)::int requests,sum(a.input_tokens+a.output_tokens)::bigint tokens
           FROM private.ai_usage a JOIN public."user" u ON u.id=a.user_id
          WHERE a.day>=date_trunc('month',current_date) GROUP BY u.id ORDER BY tokens DESC LIMIT 20`,
      ),
      pool.query(
        `SELECT l.user_id,u.name,u.email,l.enabled,l.daily_requests,l.monthly_tokens,l.updated_at
           FROM private.ai_user_limits l JOIN public."user" u ON u.id=l.user_id ORDER BY l.updated_at DESC LIMIT 100`,
      ),
      pool.query(
        `SELECT a.id,a.tool,a.status,a.preview->>'title' title,a.error,a.created_at,a.completed_at,u.email
           FROM private.ai_actions a JOIN public."user" u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 50`,
      ),
    ]);
    return Response.json(
      { policy, configured, usage: usage.rows, top: top.rows, overrides: overrides.rows, actions: actions.rows },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { user } = await adminSession();
    const input = await body(request);
    const pool = getPool();
    if (input.action === "policy") {
      const policy = {
        enabled: input.enabled === true,
        dailyRequests: integer(input.dailyRequests, "daily request limit", 0, 10000),
        monthlyTokens: integer(input.monthlyTokens, "monthly token limit", 0, 1000000000),
      };
      await pool.query(
        "INSERT INTO private.platform_settings(key,value) VALUES('ai_assistant',$1) ON CONFLICT(key) DO UPDATE SET value=$1,updated_at=now()",
        [JSON.stringify(policy)],
      );
      await pool.query("INSERT INTO private.admin_audit_log(actor_id,action,details) VALUES($1,'assistant_policy',$2)", [user.id, JSON.stringify(policy)]);
      return Response.json(policy);
    }
    if (input.action === "override") {
      const target = input.userId
        ? uuid(input.userId)
        : (await pool.query('SELECT id FROM public."user" WHERE lower(email)=$1', [email(input.email)])).rows[0]?.id;
      if (!target) throw new ApiError("No account uses that email.", 404);
      if (input.remove === true) {
        await pool.query("DELETE FROM private.ai_user_limits WHERE user_id=$1", [target]);
      } else {
        const daily = input.dailyRequests === null || input.dailyRequests === "" ? null : integer(input.dailyRequests, "daily request limit", 0, 10000);
        const monthly = input.monthlyTokens === null || input.monthlyTokens === "" ? null : integer(input.monthlyTokens, "monthly token limit", 0, 1000000000);
        await pool.query(
          `INSERT INTO private.ai_user_limits(user_id,enabled,daily_requests,monthly_tokens) VALUES($1,$2,$3,$4)
           ON CONFLICT(user_id) DO UPDATE SET enabled=$2,daily_requests=$3,monthly_tokens=$4,updated_at=now()`,
          [target, input.enabled !== false, daily, monthly],
        );
      }
      await pool.query("INSERT INTO private.admin_audit_log(actor_id,account_id,action,details) VALUES($1,$2,'assistant_override',$3)", [
        user.id,
        target,
        JSON.stringify({ remove: input.remove === true, enabled: input.enabled !== false }),
      ]);
      return Response.json({ ok: true });
    }
    throw new ApiError("Invalid action.");
  } catch (e) {
    return failure(e);
  }
}
