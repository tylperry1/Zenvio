import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import {
  cartLines,
  createMarketCheckout,
  marketSettings,
  productColumns,
} from "@/lib/marketplace";
import { allowRequest, clientIp } from "@/lib/booking-protection";
import {
  ApiError,
  email,
  session,
  sameOrigin,
  body,
  failure,
  integer,
  string,
} from "@/lib/server";
export const dynamic = "force-dynamic";

async function currentUser() {
  try {
    return (await session()).user;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}
export async function GET(request: NextRequest) {
  try {
    // Browsing is public; checkout decides between account and guest.
    const signedIn = await currentUser();
    const q = request.nextUrl.searchParams,
      page = integer(Number(q.get("page") || 0), "page", 0, 10000),
      search = string(q.get("search") || "", "search", 100, 0),
      category = string(q.get("category") || "", "category", 100, 0),
      family = string(q.get("family") || "", "family", 30, 0);
    const { rows } = await getPool().query(
      `SELECT ${productColumns} FROM private.marketplace_products WHERE status='active' AND (supplier_id IS NULL OR EXISTS(SELECT 1 FROM private.marketplace_suppliers s WHERE s.id=supplier_id AND s.active)) AND (title ILIKE $1 OR description ILIKE $1) AND ($2='' OR category=$2) AND ($4='' OR category IN (SELECT name FROM private.marketplace_categories WHERE family=$4)) ORDER BY created_at DESC,id LIMIT 50 OFFSET $3`,
      ["%" + search + "%", category, page * 50, family],
    );
    const { rows: counts } = await getPool().query(
      "SELECT count(*)::int AS total FROM private.marketplace_products WHERE status='active' AND (supplier_id IS NULL OR EXISTS(SELECT 1 FROM private.marketplace_suppliers s WHERE s.id=supplier_id AND s.active)) AND (title ILIKE $1 OR description ILIKE $1) AND ($2='' OR category=$2) AND ($3='' OR category IN (SELECT name FROM private.marketplace_categories WHERE family=$3))",
      ["%" + search + "%", category, family],
    );
    const { rows: categories } = await getPool().query(
      "SELECT DISTINCT category FROM private.marketplace_products WHERE status='active' AND (supplier_id IS NULL OR EXISTS(SELECT 1 FROM private.marketplace_suppliers s WHERE s.id=supplier_id AND s.active)) ORDER BY category",
    );
    // Families that currently have live products, so shoppers never see empty sections.
    const { rows: families } = await getPool().query(
      `SELECT f.slug,f.name,f.tagline,count(p.id)::int products FROM private.marketplace_families f
         JOIN private.marketplace_categories c ON c.family=f.slug
         JOIN private.marketplace_products p ON p.category=c.name AND p.status='active'
          AND (p.supplier_id IS NULL OR EXISTS(SELECT 1 FROM private.marketplace_suppliers s WHERE s.id=p.supplier_id AND s.active))
        GROUP BY f.slug,f.name,f.tagline,f.sort ORDER BY f.sort`,
    );
    const { rows: familyOfCategory } = await getPool().query("SELECT name,family FROM private.marketplace_categories");
    const settings = await marketSettings();
    return Response.json(
      {
        products: rows,
        categories: categories.map((r) => r.category),
        families,
        categoryFamilies: Object.fromEntries(familyOfCategory.map((r) => [r.name, r.family])),
        total: counts[0].total,
        page,
        checkoutReady: settings.checkoutEnabled && settings.paymentConfigured,
        signedIn: Boolean(signedIn),
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
    const input = await body(request);
    cartLines(input.lines);
    const signedIn = await currentUser();
    let buyer: { id: string | null; email: string; name: string };
    if (signedIn) buyer = { id: signedIn.id, email: signedIn.email, name: signedIn.name };
    else {
      // Guest checkout: no account needed. Throttled per client and per email.
      const guest = (input.guest && typeof input.guest === "object" ? input.guest : {}) as Record<string, unknown>;
      buyer = { id: null, name: string(guest.name, "name", 100, 2).trim(), email: email(guest.email) };
      if (!(await allowRequest("market-guest-checkout", clientIp(request), 10, 3600)) || !(await allowRequest("market-guest-email", buyer.email, 6, 3600)))
        throw new ApiError("Too many checkout attempts. Please wait a few minutes and try again.", 429);
    }
    return Response.json(
      await createMarketCheckout(
        {
          lines: input.lines,
          businessName: input.businessName,
          instructions: input.instructions,
        },
        buyer,
        process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
