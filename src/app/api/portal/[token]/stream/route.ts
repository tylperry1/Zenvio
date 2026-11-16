import type { NextRequest } from "next/server";
import { ApiError, failure } from "@/lib/server";
import { peekPortal, portalSignature } from "@/lib/portal";
import { changeStream } from "@/lib/support-live";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Live updates for one client portal. The token is the same bearer link as the page;
// the probe never writes last_used_at so an open tab does not look like repeated visits.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const s = await peekPortal((await params).token);
    if (!s) throw new ApiError("This portal link has expired or was replaced. Ask your provider for a new link.", 404);
    return changeStream(request, () => portalSignature(s));
  } catch (error) {
    return failure(error);
  }
}
