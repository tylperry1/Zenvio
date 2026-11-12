import { NextRequest } from "next/server";
import { session,sameOrigin,failure } from "@/lib/server";
import { syncBillingPlan } from "@/lib/billing-plan-sync";
export async function POST(req:NextRequest) {
 try {sameOrigin(req);const {token,user}=await session();return Response.json(await syncBillingPlan({id:token,email:user.email,name:user.name}),{headers:{"Cache-Control":"no-store"}});}
 catch(error){return failure(error);}
}
