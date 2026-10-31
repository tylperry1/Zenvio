import { createPublicKey,verify,createHash } from "node:crypto";
import { integrationValue } from "../platform-settings";
import { ApiError } from "../server";
export function telnyxSignatureValid(raw:string,timestamp:string,signature:string,publicKey:string,now=Date.now()) {
  if(!/^\d{10}$/.test(timestamp)||Math.abs(Math.floor(now/1000)-Number(timestamp))>300)return false;
  try {
    const keyBytes=Buffer.from(publicKey,"base64");if(keyBytes.length!==32)return false;
    const key=createPublicKey({key:Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),keyBytes]),format:"der",type:"spki"});
    return verify(null,Buffer.from(timestamp+"|"+raw),key,Buffer.from(signature,"base64"));
  }catch{return false;}
}
export function smsSegments(text:string){
  const basic="@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
  const extended="^{}\\[~]|€";let length=0,gsm=true;
  for(const char of text){if(basic.includes(char))length++;else if(extended.includes(char))length+=2;else{gsm=false;break;}}
  if(!gsm){length=text.length;return length<=70?1:Math.ceil(length/67);}
  return length<=160?1:Math.ceil(length/153);
}
export const smsDigest=(to:string,text:string)=>createHash("sha256").update(to+"\0"+text).digest("hex");
export async function telnyxConfigured(){return Boolean(await integrationValue("TELNYX_API_KEY")&&await integrationValue("TELNYX_PUBLIC_KEY"));}
export async function telnyxSend(input:{to:string;from:string;profile:string;text:string}){
  const key=await integrationValue("TELNYX_API_KEY");if(!key)throw new ApiError("Telnyx is unconfigured.",503);
  // Deliberately no automatic retry: Telnyx SMS does not promise send idempotency.
  const response=await fetch("https://api.telnyx.com/v2/messages",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({to:input.to,from:input.from,messaging_profile_id:input.profile,text:input.text,type:"SMS",use_profile_webhooks:true}),signal:AbortSignal.timeout(15000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data?.data?.id)throw new ApiError("SMS acceptance could not be confirmed. Reconcile the provider before retrying.",503);
  return data.data.id as string;
}
