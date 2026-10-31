import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { integrationValue } from "../platform-settings";
import { ApiError } from "../server";
import type { AiProviderConfig } from "./contracts";

type Block = {type:string;text?:string;id?:string;name?:string;input?:unknown;tool_use_id?:string;content?:unknown;is_error?:boolean;_gemini?:unknown};
type Message = {role:string;content:string|Block[]};
type Tool = {name:string;description?:string;input_schema:unknown};
export type ProviderRound = {content:Block[];stop_reason:string;usage:{input_tokens:number;output_tokens:number}};
export const aiKeyName = (provider:AiProviderConfig["provider"]) => provider==="gemini" ? "GEMINI_API_KEY" : provider==="cloudflare" ? "CLOUDFLARE_AI_TOKEN" : "ANTHROPIC_API_KEY";
export async function aiProviderConfigured(c:AiProviderConfig) {
  return Boolean(c.enabled&&c.model&&c.privateDataApproved&&c.toolCompatible&&(await integrationValue(aiKeyName(c.provider)))&&(c.provider!=="cloudflare"||await integrationValue("CLOUDFLARE_ACCOUNT_ID")));
}
function blocks(m:Message):Block[]{return typeof m.content==="string"?[{type:"text",text:m.content}]:m.content;}
export function geminiContents(messages:Message[]) {
  const names=new Map<string,string>();
  return messages.map(m=>({role:m.role==="assistant"?"model":"user",parts:blocks(m).map(b=>{
    if(b.type==="tool_use")names.set(b.id!,b.name!);
    if(b._gemini)return b._gemini;
    if(b.type==="tool_use"){names.set(b.id!,b.name!);return {functionCall:{id:b.id,name:b.name,args:b.input}};}
    if(b.type==="tool_result")return {functionResponse:{id:b.tool_use_id,name:names.get(b.tool_use_id!),response:{result:b.content,isError:b.is_error===true}}};
    return {text:b.text||""};
  })}));
}
export function cloudflareMessages(system:string,messages:Message[]) {
  const result:Record<string,unknown>[]=[{role:"system",content:system}];
  for(const m of messages){
    const bs=blocks(m),calls=bs.filter(b=>b.type==="tool_use");
    if(m.role==="assistant")result.push({role:"assistant",content:bs.filter(b=>b.type==="text").map(b=>b.text).join("\n")||null,...(calls.length?{tool_calls:calls.map(b=>({id:b.id,type:"function",function:{name:b.name,arguments:JSON.stringify(b.input)}}))}:{})});
    else for(const b of bs)result.push(b.type==="tool_result"?{role:"tool",tool_call_id:b.tool_use_id,content:String(b.content)}:{role:"user",content:b.text||""});
  }
  return result;
}
function tokenCount(value:unknown) {if(!Number.isSafeInteger(value)||Number(value)<0)throw new ApiError("Provider did not return valid token metering.",503);return Number(value);}
/** New providers use their documented HTTP API; existing Anthropic tools/approvals are retained. No provider fallback. */
export async function providerRound(c:AiProviderConfig,system:string,messages:Message[],tools:Tool[]):Promise<ProviderRound> {
  if(!await aiProviderConfigured(c))throw new ApiError("The selected AI provider is unavailable or unapproved.",503);
  const key=await integrationValue(aiKeyName(c.provider));
  let url:string,headers:Record<string,string>,payload:unknown;
  if(c.provider==="gemini"){
    url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model)}:generateContent`;
    headers={"x-goog-api-key":key};
    payload={systemInstruction:{parts:[{text:system}]},contents:geminiContents(messages),tools:[{functionDeclarations:tools.map(t=>({name:t.name,description:t.description,parameters:t.input_schema}))}],generationConfig:{maxOutputTokens:c.maxOutputTokens}};
  }else if(c.provider==="cloudflare"){
    const account=await integrationValue("CLOUDFLARE_ACCOUNT_ID");
    if(!/^[a-f0-9]{32}$/i.test(account))throw new ApiError("Invalid Cloudflare account configuration.",503);
    url=`https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1/chat/completions`;
    headers={Authorization:`Bearer ${key}`};
    payload={model:c.model,messages:cloudflareMessages(system,messages),tools:tools.map(t=>({type:"function",function:{name:t.name,description:t.description,parameters:t.input_schema}})),max_tokens:c.maxOutputTokens,stream:false};
  }else throw new ApiError("Use the existing Anthropic adapter.",503);
  const response=await fetch(url,{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(90000)});
  if(!response.ok)throw new ApiError(response.status===429?"The selected AI provider is rate limited.":"The selected AI model is unavailable. No fallback was attempted.",503);
  const data=await response.json();
  if(c.provider==="gemini"){
    const candidate=data.candidates?.[0];
    if(!candidate?.content?.parts||!Array.isArray(candidate.content.parts))throw new ApiError("AI provider returned no usable response.",503);
    const content:Block[]=candidate.content.parts.filter((p:any)=>p.thought!==true).map((p:any)=>p.functionCall?{type:"tool_use",id:p.functionCall.id||randomUUID(),name:p.functionCall.name,input:p.functionCall.args,_gemini:p}:{type:"text",text:p.text||"",_gemini:p});
    return {content,stop_reason:candidate.finishReason==="MAX_TOKENS"?"max_tokens":content.some(b=>b.type==="tool_use")?"tool_use":"end_turn",usage:{input_tokens:tokenCount(data.usageMetadata?.promptTokenCount),output_tokens:tokenCount((data.usageMetadata?.candidatesTokenCount??0)+(data.usageMetadata?.thoughtsTokenCount??0))}};
  }
  const choice=data.choices?.[0];if(!choice?.message)throw new ApiError("AI provider returned no usable response.",503);
  const content:Block[]=[];if(choice.message.content)content.push({type:"text",text:choice.message.content});
  for(const call of choice.message.tool_calls||[]){let input:unknown;try{input=JSON.parse(call.function.arguments);}catch{throw new ApiError("AI provider returned an invalid tool request.",503);}content.push({type:"tool_use",id:call.id,name:call.function.name,input});}
  return {content,stop_reason:choice.finish_reason==="length"?"max_tokens":content.some(b=>b.type==="tool_use")?"tool_use":"end_turn",usage:{input_tokens:tokenCount(data.usage?.prompt_tokens),output_tokens:tokenCount(data.usage?.completion_tokens)}};
}
export type CompatibleMessage = Anthropic.Beta.BetaMessage;
