import { NextRequest } from "next/server";
import { adminSession } from "@/lib/admin";
import { getPool } from "@/lib/db";
import { body,failure,sameOrigin,string } from "@/lib/server";
import { aiConfiguration,environment,validateAiConfig } from "@/lib/launch/provider-policy";
import { aiProviderConfigured } from "@/lib/launch/ai-provider";
export const dynamic="force-dynamic";
export async function GET(){try{await adminSession();const ai=await aiConfiguration();return Response.json({environment:environment(),ai,configured:await aiProviderConfigured(ai),verifiedAt:null},{headers:{"Cache-Control":"no-store"}});}catch(e){return failure(e);}}
export async function POST(request:NextRequest){try{sameOrigin(request);const {token}=await adminSession();const input=await body(request),reason=string(input.reason,"reason",500,8),config=validateAiConfig(input.ai);const db=await getPool().connect();try{await db.query("begin");await db.query("insert into private.platform_settings(key,value) values($1,$2) on conflict(key) do update set value=$2,updated_at=now()",["launch_ai:"+environment(),JSON.stringify(config)]);await db.query("insert into private.operation_log(actor_id,action,details) values($1,'launch_ai_configuration',$2)",[token,JSON.stringify({environment:environment(),config,reason})]);await db.query("commit");return Response.json({ok:true,environment:environment(),ai:config});}catch(e){await db.query("rollback");throw e;}finally{db.release();}}catch(e){return failure(e);}}
