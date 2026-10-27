import { NextRequest, NextResponse } from "next/server";

// Sessions are host-only. Keep production navigation and OAuth on one host.
export function middleware(request: NextRequest) {
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

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
