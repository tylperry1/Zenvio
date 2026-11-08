import type { NextRequest } from "next/server";
import { failure, session } from "@/lib/server";
import { customerSignature } from "@/lib/support";
import { changeStream } from "@/lib/support-live";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Live updates for a signed-in customer's own conversations.
export async function GET(request: NextRequest) {
  try {
    const { token } = await session();
    return changeStream(request, () => customerSignature(token));
  } catch (error) {
    return failure(error);
  }
}
