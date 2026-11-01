import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { integrationValue } from "@/lib/platform-settings";
import { readUpload } from "@/lib/uploads";
import { dailyWebhookValid,recordDailyUsage } from "@/lib/launch/daily-usage";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest) {
    let raw:string,event:any;
    try { raw=(await readUpload(request,64000)).toString("utf8"); event=JSON.parse(raw); }
    catch { return Response.json({error:"Invalid video event payload."},{status:400}); }
    const secret=process.env.DAILY_WEBHOOK_HMAC || await integrationValue("DAILY_WEBHOOK_HMAC");
    if(!secret) return Response.json({error:"Video webhook is not configured."},{status:503});
    if(!dailyWebhookValid(raw,request.headers.get("x-webhook-timestamp")||"",request.headers.get("x-webhook-signature")||"",secret))
        return Response.json({error:"Invalid video webhook signature."},{status:401});
    if(event?.test==="test") return Response.json({received:true});
    if(!event || typeof event!=="object") return Response.json({error:"Invalid video event."},{status:400});
    const db=await getPool().connect();
    try {
        await db.query("begin");
        const result=await recordDailyUsage(db,event);
        await db.query("commit");
        return Response.json(result);
    } catch {
        await db.query("rollback");
        return Response.json({error:"Video event could not be recorded; retry required."},{status:503});
    } finally { db.release(); }
}
