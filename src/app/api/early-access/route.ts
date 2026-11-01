import { queueReservationConfirmation } from "@/lib/early-access-mail";
import { drainDeliveries } from "@/lib/lifecycle";
import { NextRequest, after } from "next/server";
import { getPool } from "@/lib/db";
import { sameOrigin, body, email, string, integer, ApiError, failure } from "@/lib/server";
import { allowAuthAttempt } from "@/lib/auth-rate-limit";
export async function POST(request: NextRequest) {
 try {
  sameOrigin(request);
  if(process.env.BILLING_CHECKOUT_ENABLED === "true") throw new ApiError("Early-access reservations have closed. You can now create your workspace.",409);
  const input = await body(request);
  if (input.website) return Response.json({ok:true}); // Hidden bot trap.
  const address=email(input.email),name=string(input.name,"name",100,2);
  if(input.consent!==true)throw new ApiError("Agree to receive early-access and launch updates to join.");
  const plan=String(input.plan||'undecided');
  if(!['individual','team','undecided'].includes(plan))throw new ApiError("Choose a package interest.");
  const seats=plan==='team'?integer(input.seats,"seats",3,1000):1;
  const ip=request.headers.get('x-vercel-forwarded-for')?.split(',')[0]||request.headers.get('x-forwarded-for')?.split(',')[0]||'unknown';
  if(!(await allowAuthAttempt('early-access-ip',ip))||!(await allowAuthAttempt('early-access-email',address)))throw new ApiError("Please wait a minute before trying again.",429);
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    const promotion=(await db.query("SELECT value FROM private.platform_settings WHERE key='pricing_v3_launch_promotion' FOR SHARE")).rows[0]?.value;
    if(promotion?.enabled!==true)throw new ApiError("Early-adopter reservations are currently paused. Existing reservations are preserved.",409);
    // Reserve and enqueue together. Repeated submissions never trigger another email.
    const signup = (await db.query("INSERT INTO private.early_access_signups(email,name,plan,seats) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING RETURNING id,name,email",[address,name,plan,seats])).rows[0];
    if(signup) await queueReservationConfirmation(db, signup);
    await db.query("COMMIT");
    if(signup) after(async()=>{try{await drainDeliveries(undefined,1,signup.id);}catch{console.error("Early-access confirmation remains queued for retry.");}});
  } catch(e) {await db.query("ROLLBACK");throw e;} finally {db.release();}
  return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
 } catch(e){return failure(e);}
}
