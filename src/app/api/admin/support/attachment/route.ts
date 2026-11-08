import type { NextRequest } from "next/server";
import { supportAttachment } from "@/lib/support";
import { failure } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try { return await supportAttachment(request, true, false); } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try { return await supportAttachment(request, true, true); } catch (error) { return failure(error); }
}
