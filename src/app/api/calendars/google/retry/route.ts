import { NextRequest } from "next/server";
import { timingSafeEqual, createHash } from "node:crypto";
import { runGoogleJobs } from "@/lib/google-calendar";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: NextRequest) {
  const key = process.env.CRON_SECRET,
    provided = request.headers.get("authorization") || "";
  if (
    !key ||
    !timingSafeEqual(
      createHash("sha256").update(provided).digest(),
      createHash("sha256")
        .update("Bearer " + key)
        .digest(),
    )
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json({ delivered: await runGoogleJobs(undefined, 20) });
  } catch {
    return Response.json({ error: "Calendar retry failed." }, { status: 503 });
  }
}
