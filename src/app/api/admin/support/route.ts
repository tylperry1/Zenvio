import type { NextRequest } from "next/server";
import { failure } from "@/lib/server";
import { supportGet, supportPost } from "@/lib/support";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try { return Response.json(await supportGet(request, true), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try { return Response.json(await supportPost(request, true)); }
  catch (error) { return failure(error); }
}
