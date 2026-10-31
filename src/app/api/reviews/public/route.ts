import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { publicReviews } from "@/lib/marketing";
import { failure } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const host = (request.nextUrl.searchParams.get("host") || "").toLowerCase();
    if (!/^[a-z0-9-]{1,80}$/.test(host)) return Response.json({ summary: { total: 0 }, reviews: [] });
    const owner = (await getPool().query("SELECT id FROM public.profiles WHERE slug=$1", [host])).rows[0];
    if (!owner) return Response.json({ summary: { total: 0 }, reviews: [] });
    return Response.json(await publicReviews(owner.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
