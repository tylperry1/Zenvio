import { NextRequest } from "next/server";
import { jobsAuthorized } from "@/lib/job-authorization";
import { processScheduledJobs, runnerStatus } from "@/lib/job-runner";
import { mailReady } from "@/lib/mail";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(r: NextRequest) {
  if (!(await jobsAuthorized(r.headers.get("authorization"))))
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  try {
    if (r.nextUrl.searchParams.get("probe") === "1")
      return Response.json(
        {
          ok: true,
          configured: await mailReady(),
          scheduler: await runnerStatus(),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    return Response.json(await processScheduledJobs(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      {
        error:
          "Job processing failed. Review scheduler health and delivery settings.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
