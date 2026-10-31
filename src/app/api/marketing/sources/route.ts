import { NextRequest } from "next/server";
import { sourceReport } from "@/lib/marketing";
import { failure, integer, session } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { token } = await session();
    const days = integer(Number(request.nextUrl.searchParams.get("days") || 30), "days", 7, 365);
    return Response.json(await sourceReport(token, days), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
