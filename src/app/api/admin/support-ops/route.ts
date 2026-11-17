import type { NextRequest } from "next/server";
import { failure } from "@/lib/server";
import { supportOpsGet, supportOpsPost } from "@/lib/support-ops";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    return Response.json(await supportOpsGet(request), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    return Response.json(await supportOpsPost(request));
  } catch (error) {
    return failure(error);
  }
}
