import type { NextRequest } from "next/server";
import { workspaceSignature } from "@/lib/app-live";
import { failure, session } from "@/lib/server";
import { changeStream } from "@/lib/support-live";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Live updates for a signed-in host's workspace (calendar, inbox, clients, jobs, payments).
export async function GET(request: NextRequest) {
  try {
    const { token } = await session();
    return changeStream(request, () => workspaceSignature(token));
  } catch (error) {
    return failure(error);
  }
}
