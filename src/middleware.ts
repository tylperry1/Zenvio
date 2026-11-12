import { NextRequest, NextResponse } from "next/server";

// Sessions are host-only. Keep production navigation and OAuth on one host.
export async function middleware(request: NextRequest) {
  const path=request.nextUrl.pathname;
  if(!path.startsWith("/api/auth")&&!path.startsWith("/admin")&&!path.startsWith("/api/admin")&&!["/sign-in","/maintenance","/support"].includes(path)&&!path.includes("webhook")&&!path.startsWith("/api/owner")&&!/\.[a-z0-9]+$/i.test(path)){
   const {launchControls}=await import("./lib/launch-controls"),controls=await launchControls();
   if(controls.maintenance){const {getAuth}=await import("./lib/auth"),me=await getAuth().api.getSession({headers:request.headers});const {getPool}=await import("./lib/db");const admin=me&&(await getPool().query("SELECT 1 FROM private.platform_roles WHERE user_id=$1 AND enabled",[me.user.id])).rowCount;if(!admin)return path.startsWith("/api/")?NextResponse.json({error:"Zenvio is undergoing maintenance."},{status:503,headers:{"Retry-After":"300"}}):NextResponse.rewrite(new URL("/maintenance",request.url),{status:503});}
   const feature=path.startsWith("/app/smart-cards")||path.startsWith("/api/smart-profiles")?"smartCards":path.startsWith("/app/growth")||path.startsWith("/api/growth")?"growth":path.startsWith("/app/assistant")||path.startsWith("/api/assistant")?"assistant":null;
   if(feature&&!controls.features[feature])return path.startsWith("/api/")?NextResponse.json({error:"This feature is not available."},{status:404}):NextResponse.redirect(new URL("/app",request.url));
  }
  if (process.env.VERCEL_ENV !== "production") return NextResponse.next();
  const host = request.nextUrl.hostname;
  if (host !== "www.gozenvio.com" && host !== "zenvio-two.vercel.app") {
    return NextResponse.next();
  }
  const target = request.nextUrl.clone();
  target.protocol = "https:";
  target.hostname = "gozenvio.com";
  target.port = "";
  return NextResponse.redirect(target, 307);
}

export const config = { runtime: "nodejs", matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
