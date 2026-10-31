import { getPool } from "../db";
import { ApiError } from "../server";

export type AssistantPolicy = { enabled: boolean; dailyRequests: number; monthlyTokens: number };
const defaults: AssistantPolicy = { enabled: true, dailyRequests: 60, monthlyTokens: 3000000 };

export async function assistantPolicy(): Promise<AssistantPolicy> {
  const { rows } = await getPool().query("SELECT value FROM private.platform_settings WHERE key='ai_assistant'");
  return { ...defaults, ...(rows[0]?.value || {}) };
}

// Effective limits for one user: the platform policy, narrowed or widened by an admin override.
export async function assistantAllowance(userId: string) {
  const [policy, override, usage] = await Promise.all([
    assistantPolicy(),
    getPool().query("SELECT enabled,daily_requests,monthly_tokens FROM private.ai_user_limits WHERE user_id=$1", [userId]),
    getPool().query(
      `SELECT coalesce(sum(requests) FILTER (WHERE day=current_date),0)::int today,
              coalesce(sum(input_tokens+output_tokens),0)::bigint month_tokens
         FROM private.ai_usage WHERE user_id=$1 AND day>=date_trunc('month',current_date)`,
      [userId],
    ),
  ]);
  const o = override.rows[0];
  const limits = {
    enabled: policy.enabled && (o ? o.enabled : true),
    dailyRequests: o?.daily_requests ?? policy.dailyRequests,
    monthlyTokens: Number(o?.monthly_tokens ?? policy.monthlyTokens),
  };
  const used = { today: usage.rows[0].today as number, monthTokens: Number(usage.rows[0].month_tokens) };
  return { limits, used };
}

export async function requireAllowance(userId: string) {
  const { limits, used } = await assistantAllowance(userId);
  if (!limits.enabled) throw new ApiError("The assistant is turned off for this account.", 403);
  if (used.today >= limits.dailyRequests)
    throw new ApiError("You’ve reached today’s assistant limit. It resets at midnight UTC.", 429);
  if (used.monthTokens >= limits.monthlyTokens)
    throw new ApiError("You’ve reached this month’s assistant usage limit.", 429);
}

export async function recordUsage(userId: string, usage: { requests?: number; input?: number; output?: number }) {
  await getPool().query(
    `INSERT INTO private.ai_usage(user_id,day,requests,input_tokens,output_tokens) VALUES($1,current_date,$2,$3,$4)
     ON CONFLICT(user_id,day) DO UPDATE SET requests=ai_usage.requests+$2,input_tokens=ai_usage.input_tokens+$3,output_tokens=ai_usage.output_tokens+$4`,
    [userId, usage.requests || 0, usage.input || 0, usage.output || 0],
  );
}
