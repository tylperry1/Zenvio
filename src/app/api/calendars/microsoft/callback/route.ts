import { NextRequest } from "next/server";
import { finishMicrosoftConnection } from "@/lib/microsoft-calendar";
import { failure, session } from "@/lib/server";
export async function GET(request:NextRequest){
 try{const {token}=await session();const state=request.nextUrl.searchParams.get("state")||"";
 const code=request.nextUrl.searchParams.get("code")||"";await finishMicrosoftConnection(token,state,code);
 return Response.redirect(new URL("/app/connections?microsoft=connected",request.nextUrl.origin));}
 catch(error){return failure(error);}
}
