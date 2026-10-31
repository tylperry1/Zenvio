import {NextRequest} from "next/server";
import {adminSession} from "@/lib/admin";
import {getPool} from "@/lib/db";
import {body,failure,sameOrigin,ApiError} from "@/lib/server";
import {integrationValue} from "@/lib/platform-settings";
import {aiConfiguration,estimatedMicros,reserveUsage,settleUsage,uncertainUsage} from "@/lib/launch/provider-policy";
import {providerRound} from "@/lib/launch/ai-provider";
import {allowRequest} from "@/lib/booking-protection";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest){let reservation:string|undefined;try{sameOrigin(request);const {token}=await adminSession(),input=await body(request);if(input.confirmation!=="RUN_BILLABLE_MODEL_PROBE")throw new ApiError("Confirm the metered model compatibility probe.",409);if(!await allowRequest("ai-model-probe",token,5,3600))throw new ApiError("Model probe limit reached.",429);const config=await aiConfiguration();if(!config.enabled)throw new ApiError("Save an approved model configuration first.",409);
 reservation=await reserveUsage({userId:token,provider:"ai",model:config.provider+"/"+config.model,micros:estimatedMicros(8192,config.maxOutputTokens,config),platformCap:config.monthlyCapMicros,workspaceCap:config.workspaceMonthlyCapMicros});
 const tool={name:"zenvio_probe",description:"Confirm tool compatibility",input_schema:{type:"object",properties:{ok:{type:"boolean"}},required:["ok"]}},system="Call zenvio_probe with ok=true. This is a synthetic compatibility test; no client data is included.",messages=[{role:"user",content:"Call zenvio_probe now."}];
 let result:any;
 if(config.provider==="anthropic"){
  const key=await integrationValue("ANTHROPIC_API_KEY"),r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":key,"anthropic-version":"2023-06-01","Content-Type":"application/json"},body:JSON.stringify({model:config.model,max_tokens:config.maxOutputTokens,system,messages,tools:[tool]}),signal:AbortSignal.timeout(60000)});if(!r.ok)throw new ApiError("The selected model probe failed.",503);result=await r.json();
 }else result=await providerRound(config,system,messages,[tool]);
 if(!result.usage||!Number.isSafeInteger(result.usage.input_tokens)||!Number.isSafeInteger(result.usage.output_tokens))throw new ApiError("Model probe did not return usable metering.",503);
 await settleUsage(reservation,{micros:estimatedMicros(result.usage.input_tokens,result.usage.output_tokens,config),input:result.usage.input_tokens,output:result.usage.output_tokens});reservation=undefined;
 if(!result.content?.some((c:any)=>c.type==="tool_use"&&c.name==="zenvio_probe"&&c.input?.ok===true))throw new ApiError("This model did not pass tool compatibility.",409);
 await getPool().query("insert into private.operation_log(actor_id,action,details) values($1,'ai_model_probe_passed',$2)",[token,JSON.stringify({provider:config.provider,model:config.model,checkedAt:new Date().toISOString(),synthetic:true})]);
 return Response.json({ok:true,provider:config.provider,model:config.model,toolCompatible:true,scope:"synthetic_tool_probe",checkedAt:new Date().toISOString()});
 }catch(e){if(reservation)await uncertainUsage(reservation);return failure(e);}}
