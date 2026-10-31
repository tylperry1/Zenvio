import { NextRequest } from "next/server";
import { adminSession } from "@/lib/admin";
import { failure, ApiError } from "@/lib/server";
import { allowRequest } from "@/lib/booking-protection";
import { printfulCatalog, printfulProduct } from "@/lib/launch/printful";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) { try {
    const { token } = await adminSession();
    if (!await allowRequest("printful-catalog", token, 20, 60))
        throw new ApiError("Supplier query limit reached.", 429);
    const product = request.nextUrl.searchParams.get("productId");
    return Response.json(product ? await printfulProduct(Number(product)) : await printfulCatalog(Number(request.nextUrl.searchParams.get("offset") || 0)), { headers: { "Cache-Control": "no-store" } });
}
catch (e) {
    return failure(e);
} }
