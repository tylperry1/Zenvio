import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { beginMicrosoftConnection,disconnectMicrosoft,microsoftBusy,microsoftConfigured,microsoftRedirect,runMicrosoftJobs } from "@/lib/microsoft-calendar";
import { ApiError,body,failure,sameOrigin,session,string } from "@/lib/server";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest){try{const {token}=await session();const {rows}=await getPool().query(
 "select account_id,account_email,status,check_conflicts,sync_events,selected_calendar_id,last_sync_at,last_error from private.microsoft_calendar_connections where user_id=$1 order by created_at",[token]);
 return Response.json({configured:await microsoftConfigured(),redirectUri:microsoftRedirect(request.nextUrl.origin),connections:rows},{headers:{"Cache-Control":"no-store"}});}catch(e){return failure(e);}}
export async function POST(request:NextRequest){try{sameOrigin(request);const {token}=await session();const input=await body(request);
 if(input.action==="connect")return Response.json({url:await beginMicrosoftConnection(token,request.nextUrl.origin)});
 const account=string(input.accountId,"Microsoft account",255);
 if(input.action==="disconnect"){await disconnectMicrosoft(token,account);return Response.json({ok:true});}
 if(input.action==="check"){const start=new Date(),end=new Date(start.getTime()+86400000);await microsoftBusy(token,account,start.toISOString(),end.toISOString());return Response.json({ok:true,checkedAt:new Date().toISOString()});}
 if(input.action==="settings"){if(typeof input.checkConflicts!=="boolean"||typeof input.syncEvents!=="boolean")throw new ApiError("Invalid calendar settings.");
 const result=await getPool().query("update private.microsoft_calendar_connections set check_conflicts=$3,sync_events=$4,updated_at=now() where user_id=$1 and account_id=$2 returning account_id",[token,account,input.checkConflicts,input.syncEvents]);
 if(!result.rowCount)throw new ApiError("Microsoft account not found.",404);return Response.json({ok:true});}
 if(input.action==="sync"){await getPool().query("update private.microsoft_calendar_jobs set attempts=0,not_before=now() where user_id=$1 and (locked_until is null or locked_until<now())",[token]);
  return Response.json({ok:true,delivered:await runMicrosoftJobs(token,20)});}
 throw new ApiError("Invalid Microsoft Calendar action.");}catch(e){return failure(e);}}
