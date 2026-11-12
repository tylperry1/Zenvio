import { NextRequest } from "next/server";
import { adminSession } from "@/lib/admin";
import { launchControls,sandboxAccepted,launchDefaults } from "@/lib/launch-controls";
import { getPool } from "@/lib/db";
import { body,sameOrigin,failure,ApiError,string } from "@/lib/server";
export async function GET(){try{await adminSession();return Response.json({controls:await launchControls(),sandboxAccepted:await sandboxAccepted()},{headers:{"Cache-Control":"no-store"}});}catch(e){return failure(e);}}
export async function POST(req:NextRequest){try{sameOrigin(req);const {token}=await adminSession();const v=await body(req),reason=string(v.reason,"reason",500,5),input=v.controls as Record<string,unknown>;
 if(!input||typeof input!=="object")throw new ApiError("Choose launch controls.");
 const next={...await launchControls()};
 for(const key of ["signupEnabled","waitlistEnabled","invitationOnly","checkoutEnabled","maintenance","bannerEnabled"] as const){if(typeof input[key]!=="boolean")throw new ApiError("Invalid launch switch.");next[key]=input[key] as boolean;}
 next.banner=string(input.banner||"","banner",180,0);next.launchDate=string(input.launchDate,"launch date",10,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(next.launchDate)||!Number.isFinite(Date.parse(next.launchDate)))throw new ApiError("Choose a valid launch date.");
 const features=input.features as Record<string,unknown>;for(const key of Object.keys(launchDefaults.features) as (keyof typeof launchDefaults.features)[]){if(typeof features?.[key]!=="boolean")throw new ApiError("Invalid feature visibility.");next.features[key]=features[key] as boolean;}
 if(next.checkoutEnabled&&!await sandboxAccepted())throw new ApiError("Stripe sandbox lifecycle acceptance must pass before enabling checkout.",409);
 const db=await getPool().connect();try{await db.query("BEGIN");await db.query("INSERT INTO private.platform_settings(key,value) VALUES('launch_controls',$1) ON CONFLICT(key) DO UPDATE SET value=$1,updated_at=now()",[JSON.stringify(next)]);await db.query("INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'launch_controls_updated',$2)",[token,JSON.stringify({reason,controls:next})]);await db.query("COMMIT");}catch(e){await db.query("ROLLBACK");throw e;}finally{db.release();}
 return Response.json({ok:true});}catch(e){return failure(e);}}
