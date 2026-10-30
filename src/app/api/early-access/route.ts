import { NextRequest } from "next/server";
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
  // A repeated email never overwrites another person's preferences or offer.
  await getPool().query("INSERT INTO private.early_access_signups(email,name,plan,seats) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING",[address,name,plan,seats]);
  return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
 } catch(e){return failure(e);}
}
