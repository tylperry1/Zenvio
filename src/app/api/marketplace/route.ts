import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import {
  cartLines,
  createMarketCheckout,
  marketSettings,
  productColumns,
} from "@/lib/marketplace";
import {
  session,
  sameOrigin,
  body,
  failure,
  integer,
  string,
} from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    await session();
    const q = request.nextUrl.searchParams,
      page = integer(Number(q.get("page") || 0), "page", 0, 10000),
      search = string(q.get("search") || "", "search", 100, 0),
      category = string(q.get("category") || "", "category", 100, 0);
    const { rows } = await getPool().query(
      `SELECT ${productColumns} FROM private.marketplace_products WHERE status='active' AND (supplier_id IS NULL OR EXISTS(SELECT 1 FROM private.marketplace_suppliers s WHERE s.id=supplier_id AND s.active)) AND (title ILIKE $1 OR description ILIKE $1) AND ($2='' OR category=$2) ORDER BY created_at DESC,id LIMIT 50 OFFSET $3`,
      ["%" + search + "%", category, page * 50],
    );
    const { rows: counts } = await getPool().query(
      "SELECT count(*)::int AS total FROM private.marketplace_products WHERE status='active' AND (supplier_id IS NULL OR EXISTS(SELECT 1 FROM private.marketplace_suppliers s WHERE s.id=supplier_id AND s.active)) AND (title ILIKE $1 OR description ILIKE $1) AND ($2='' OR category=$2)",
      ["%" + search + "%", category],
    );
    const { rows: categories } = await getPool().query(
      "SELECT DISTINCT category FROM private.marketplace_products WHERE status='active' AND (supplier_id IS NULL OR EXISTS(SELECT 1 FROM private.marketplace_suppliers s WHERE s.id=supplier_id AND s.active)) ORDER BY category",
    );
    const settings = await marketSettings();
    return Response.json(
      {
        products: rows,
        categories: categories.map((r) => r.category),
        total: counts[0].total,
        page,
        checkoutReady: settings.checkoutEnabled && settings.paymentConfigured,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { user } = await session(),
      input = await body(request);
    cartLines(input.lines);
    return Response.json(
      await createMarketCheckout(
        {
          lines: input.lines,
          businessName: input.businessName,
          instructions: input.instructions,
        },
        { id: user.id, email: user.email, name: user.name },
        process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
