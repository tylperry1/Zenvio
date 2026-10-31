import { NextRequest } from "next/server";
import { body,failure,sameOrigin,session,uuid,ApiError } from "@/lib/server";
import { dailyAccess } from "@/lib/launch/daily";
import { allowRequest,clientIp } from "@/lib/booking-protection";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest){try{sameOrigin(request);const input=await body(request);if(!await allowRequest("video-access",clientIp(request),20,60))throw new ApiError("Too many meeting requests.",429);const id=uuid(input.appointmentId);const scope=input.guestToken?{guestToken:uuid(input.guestToken)}:{userId:(await session()).token};return Response.json(await dailyAccess(id,scope),{headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});}catch(e){return failure(e);}}
