import { NextRequest } from "next/server";
import { ApiError,body,failure,sameOrigin,session,string } from "@/lib/server";
import { allowRequest } from "@/lib/booking-protection";
import { googleExternalEvent } from "@/lib/google-calendar";
import { microsoftExternalEvent } from "@/lib/microsoft-calendar";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest){
 try{
  sameOrigin(request);
  const {token}=await session(),input=await body(request);
  if(!["read","update"].includes(String(input.action)) || !["google","microsoft"].includes(String(input.provider)))throw new ApiError("Invalid external calendar operation.");
  const write=input.action==="update";
  if(!await allowRequest(write?"external-calendar-write":"external-calendar-read",token,write?20:60,write?3600:60))throw new ApiError("External calendar request limit reached.",429);
  const accountId=string(input.accountId,"calendar account",200),eventId=string(input.eventId,"event reference",2048);
  const update=write?{title:string(input.title,"event title",200,1),location:string(input.location||"","location",300,0),version:string(input.version,"event version",512,3),confirmNotifications:input.confirmNotifications===true}:undefined;
  const result=input.provider==="google"?await googleExternalEvent(token,accountId,eventId,update):await microsoftExternalEvent(token,accountId,eventId,update);
  return Response.json(result,{headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
 }catch(e){return failure(e);}
}
