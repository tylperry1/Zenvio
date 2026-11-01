import { getPool } from "../db";
import { ApiError } from "../server";
import type { AiProviderConfig } from "./contracts";
export const environment = () => process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
export const defaultAiConfig: AiProviderConfig = {
    enabled: false, provider: "gemini", model: "", toolCompatible: false, privateDataApproved: false,
    inputMicrosPerMillion: 0, outputMicrosPerMillion: 0,
    monthlyCapMicros: 0, workspaceMonthlyCapMicros: 0, maxOutputTokens: 2048, fallback: "none",
};
export function validateAiConfig(value: unknown): AiProviderConfig {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new ApiError("Invalid AI configuration.");
    const c = value as AiProviderConfig;
    if (!["anthropic", "gemini", "cloudflare"].includes(c.provider) || c.fallback !== "none")
        throw new ApiError("Unsupported provider or fallback policy.");
    if (typeof c.model !== "string" || !/^[A-Za-z0-9@._:/-]{0,160}$/.test(c.model))
        throw new ApiError("Invalid model ID.");
    for (const k of ["enabled", "toolCompatible", "privateDataApproved"] as const)
        if (typeof c[k] !== "boolean")
            throw new ApiError("Invalid AI approval state.");
    for (const k of ["inputMicrosPerMillion", "outputMicrosPerMillion", "monthlyCapMicros", "workspaceMonthlyCapMicros"] as const)
        if (!Number.isSafeInteger(c[k]) || c[k] < 0 || c[k] > 1000000000000)
            throw new ApiError("Invalid AI budget or rate.");
    if (!Number.isInteger(c.maxOutputTokens) || c.maxOutputTokens < 256 || c.maxOutputTokens > 16000)
        throw new ApiError("Invalid output token limit.");
    if (c.enabled && (!c.model || !c.toolCompatible || !c.privateDataApproved || !c.monthlyCapMicros || !c.workspaceMonthlyCapMicros || !c.inputMicrosPerMillion || !c.outputMicrosPerMillion))
        throw new ApiError("Verify model tools, private-data terms, pricing and spending caps before activation.", 409);
    return { ...defaultAiConfig, ...c };
}
export async function aiConfiguration(): Promise<AiProviderConfig> {
    const { rows } = await getPool().query("select value from private.platform_settings where key=$1", ["launch_ai:" + environment()]);
    return rows[0] ? validateAiConfig(rows[0].value) : { ...defaultAiConfig };
}
export function estimatedMicros(input: number, output: number, config: Pick<AiProviderConfig, "inputMicrosPerMillion" | "outputMicrosPerMillion">) {
    if (![input, output].every(n => Number.isSafeInteger(n) && n >= 0))
        throw new ApiError("Invalid provider usage.", 503);
    const n = Math.ceil((input * config.inputMicrosPerMillion + output * config.outputMicrosPerMillion) / 1000000);
    if (!Number.isSafeInteger(n))
        throw new ApiError("Provider budget overflow.", 503);
    return n;
}
/** Global advisory lock serializes spend reservations across workers. Unknown outcomes stay charged to the cap. */
export async function reserveUsage(input: {
    userId: string;
    provider: string;
    model?: string;
    micros: number;
    platformCap: number;
    workspaceCap: number;
    meter?: "videoMinutes";
    quantity?: number;
}) {
    if (!Number.isSafeInteger(input.micros) || input.micros <= 0 || ![input.platformCap,input.workspaceCap].every(n => Number.isSafeInteger(n) && n > 0))
        throw new ApiError("Provider spending is disabled.", 503);
    const db = await getPool().connect();
    try {
        await db.query("begin");
        await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", ["provider-spend:" + input.provider]);
        const control=(await db.query("select value from private.platform_settings where key=$1",["provider_budget:"+environment()+":"+input.provider])).rows[0]?.value;
        let platformCap=input.platformCap,workspaceCap=input.workspaceCap;
        if(control){
          if(control.suspended===true)throw new ApiError("This optional provider is temporarily suspended.",503);
          if(![control.platformCap,control.workspaceCap].every(n=>Number.isSafeInteger(n)&&n>0))throw new ApiError("Provider budget needs administrator review.",503);
          platformCap=Math.min(platformCap,control.platformCap);workspaceCap=Math.min(workspaceCap,control.workspaceCap);
        }
        // Billing workspace roots share one budget. A staff account cannot escape it by switching seats.
        const roots = (await db.query("select owner_id from private.team_entitlement_roots($1) order by owner_id limit 1", [input.userId])).rows;
        const owner = roots[0]?.owner_id || input.userId;
        const { rows } = await db.query(`select coalesce(sum(case when state='settled' then actual_micros else reserved_micros end),0)::text total,
      coalesce(sum(case when state='settled' then actual_micros else reserved_micros end) filter(where user_id=$2),0)::text workspace
      from private.provider_usage_reservations where provider=$1 and state<>'released' and created_at>=date_trunc('month',now())`, [input.provider, owner]);
        if (Number(rows[0].total) + input.micros > platformCap || Number(rows[0].workspace) + input.micros > workspaceCap)
            throw new ApiError("Provider monthly spending limit reached.", 429);
        const r = await db.query("insert into private.provider_usage_reservations(user_id,provider,model,reserved_micros) values($1,$2,$3,$4) returning id", [owner, input.provider, input.model || null, input.micros]);
        if(input.provider === "ai" || input.meter === "videoMinutes") {
            const {reserveSubscriptionUnits}=await import("../subscription-usage");
            const {aiCreditsForCost}=await import("../subscription-offers.mjs");
            const usageId=await reserveSubscriptionUnits(db,input.userId,input.meter || "aiCredits",input.meter ? Number(input.quantity) : aiCreditsForCost(input.micros),r.rows[0].id);
            if(usageId)await db.query("update private.provider_usage_reservations set subscription_usage_id=$2 where id=$1",[r.rows[0].id,usageId]);
        }
        await db.query("commit");
        return r.rows[0].id as string;
    }
    catch (e) {
        await db.query("rollback");
        throw e;
    }
    finally {
        db.release();
    }
}
export async function settleUsage(id: string, usage: {
    micros: number;
    input?: number;
    output?: number;
    units?: number;
}) {
    if(!Number.isSafeInteger(usage.micros)||usage.micros<0||![usage.input||0,usage.output||0].every(n=>Number.isSafeInteger(n)&&n>=0))throw new ApiError("Invalid provider settlement.",503);
    const db=await getPool().connect();
    try {
      await db.query("begin");
      const row=(await db.query("select subscription_usage_id from private.provider_usage_reservations where id=$1 for update",[id])).rows[0];
      if(row?.subscription_usage_id){
        const {settleSubscriptionUnits}=await import("../subscription-usage");
        const {aiCreditsForCost}=await import("../subscription-offers.mjs");
        await settleSubscriptionUnits(db,row.subscription_usage_id,aiCreditsForCost(usage.micros));
      }
      await db.query(`update private.provider_usage_reservations set state='settled',actual_micros=$2,input_tokens=$3,output_tokens=$4,units=$5,settled_at=now() where id=$1 and state in ('reserved','uncertain')`, [id, usage.micros, usage.input || 0, usage.output || 0, usage.units ?? null]);
      await db.query("commit");
    }catch(e){await db.query("rollback");throw e;}finally{db.release();}
}
export async function uncertainUsage(id: string) { await getPool().query("update private.provider_usage_reservations set state='uncertain' where id=$1 and state='reserved'", [id]); }
