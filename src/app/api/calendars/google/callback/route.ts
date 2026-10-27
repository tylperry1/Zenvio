import { NextRequest, NextResponse, after } from "next/server";
import { session } from "@/lib/server";
import { finishGoogleConnection, runGoogleJobs } from "@/lib/google-calendar";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: NextRequest) {
  let result = "failed";
  try {
    const { token } = await session();
    if (request.nextUrl.searchParams.get("error")) result = "denied";
    else {
      await finishGoogleConnection(
        token,
        request.nextUrl.searchParams.get("state") || "",
        request.nextUrl.searchParams.get("code") || "",
      );
      after(() => runGoogleJobs(token, 20).then(() => {}));
      result = "connected";
    }
  } catch {}
  const response = NextResponse.redirect(
    new URL(
      "/app/connections?google=" + result,
      process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin,
    ),
  );
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
