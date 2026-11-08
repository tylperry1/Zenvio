import type { NextRequest } from "next/server";
import { adminSession } from "@/lib/admin";
import { failure } from "@/lib/server";
import { agentHeartbeat, staffSignature } from "@/lib/support";
import { changeStream } from "@/lib/support-live";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Live updates for the employee support inbox. Each connection also counts as console activity.
export async function GET(request: NextRequest) {
  try {
    const { token } = await adminSession("support");
    await agentHeartbeat(token);
    return changeStream(request, () => staffSignature());
  } catch (error) {
    return failure(error);
  }
}
