import type { NextRequest } from "next/server";
import { ApiError, failure } from "@/lib/server";
import { changeStream } from "@/lib/support-live";
import { visitorSignature, visitorToken } from "@/lib/support-visitor";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    const token = visitorToken(request);
    if (!token) throw new ApiError("Start a conversation first.", 404);
    return changeStream(request, () => visitorSignature(token));
  } catch (error) {
    return failure(error);
  }
}
