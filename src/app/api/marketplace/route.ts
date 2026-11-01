import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import {
  cartLines,
  createMarketCheckout,
  marketSettings,
  productColumns,
} from "@/lib/marketplace";
import {
  sameOrigin,
  body,
  failure,
  integer,
  string,
  email,
  ApiError,
} from "@/lib/server";
import { shopper, storefrontViewer } from "@/lib/studio/shopper";
import { cookies } from "next/headers";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const viewer = await storefrontViewer();
    const q = request.nextUrl.searchParams,
      page = integer(Number(q.get("page") || 0), "page", 0, 10000),
      search = string(q.get("search") || "", "search", 100, 0),
      category = string(q.get("category") || "", "category", 100, 0),
      family = string(q.get("family") || "", "family", 30, 0),
      collection = ["featured", "custom"].includes(q.get("collection") || "") ? q.get("collection")! : "";
    const { rows } = await getPool().query(
      `SELECT ${productColumns} FROM private.marketplace_products WHERE status='active' AND (supplier_id IS NULL OR EXISTS(SELECT 1 FROM private.marketplace_suppliers s WHERE s.id=supplier_id AND s.active)) AND (title ILIKE $1 OR description ILIKE $1) AND ($2='' OR category=$2) AND ($4='' OR category IN (SELECT name FROM private.marketplace_categories WHERE family=$4)) AND ($5::boolean OR EXISTS(SELECT 1 FROM private.supplier_products sp WHERE sp.product_id=marketplace_products.id)) AND ($6='' OR ($6='featured' AND featured) OR ($6='custom' AND EXISTS(SELECT 1 FROM private.supplier_products sp WHERE sp.product_id=marketplace_products.id))) ORDER BY featured DESC,created_at DESC,id LIMIT 50 OFFSET $3`,
      ["%" + search + "%", category, page * 50, family, !viewer.guest, collection],
    );
    const { rows: counts } = await getPool().query(
      "SELECT count(*)::int AS total FROM private.marketplace_products WHERE status='active' AND (supplier_id IS NULL OR EXISTS(SELECT 1 FROM private.marketplace_suppliers s WHERE s.id=supplier_id AND s.active)) AND (title ILIKE $1 OR description ILIKE $1) AND ($2='' OR category=$2) AND ($3='' OR category IN (SELECT name FROM private.marketplace_categories WHERE family=$3)) AND ($4::boolean OR EXISTS(SELECT 1 FROM private.supplier_products sp WHERE sp.product_id=marketplace_products.id)) AND ($5='' OR ($5='featured' AND featured) OR ($5='custom' AND EXISTS(SELECT 1 FROM private.supplier_products sp WHERE sp.product_id=marketplace_products.id)))",
      ["%" + search + "%", category, family, !viewer.guest, collection],
    );
    const { rows: categories } = await getPool().query(
      "SELECT DISTINCT category FROM private.marketplace_products WHERE status='active' AND (supplier_id IS NULL OR EXISTS(SELECT 1 FROM private.marketplace_suppliers s WHERE s.id=supplier_id AND s.active)) AND ($1::boolean OR EXISTS(SELECT 1 FROM private.supplier_products sp WHERE sp.product_id=marketplace_products.id)) ORDER BY category",
      [!viewer.guest],
    );
    // Families that currently have live products, so shoppers never see empty sections.
    const { rows: families } = await getPool().query(
      `SELECT f.slug,f.name,f.tagline,count(p.id)::int products FROM private.marketplace_families f
         JOIN private.marketplace_categories c ON c.family=f.slug
         JOIN private.marketplace_products p ON p.category=c.name AND p.status='active'
          AND (p.supplier_id IS NULL OR EXISTS(SELECT 1 FROM private.marketplace_suppliers s WHERE s.id=p.supplier_id AND s.active))
          AND ($1::boolean OR EXISTS(SELECT 1 FROM private.supplier_products sp WHERE sp.product_id=p.id))
        GROUP BY f.slug,f.name,f.tagline,f.sort ORDER BY f.sort`,
      [!viewer.guest],
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
        guest: viewer.guest,
        signedIn: !viewer.guest,
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
    const buyer = await shopper(),
      input = await body(request);
    cartLines(input.lines);
    if (buyer.kind === "guest" && !input.email)
      throw new ApiError("Enter your email for order updates.");
    const result = await createMarketCheckout(
      {
        lines: input.lines,
        businessName: input.businessName,
        instructions: input.instructions,
        shippingAddress: input.shippingAddress,
      },
      buyer.kind === "user"
        ? { id: buyer.userId, email: buyer.email, name: buyer.name }
        : {
            id: null,
            email: email(input.email),
            name: string((input.shippingAddress as { name?: unknown })?.name, "name", 100, 2),
            guestHash: buyer.guestHash,
          },
      process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin,
    );
    if (result.guestToken)
      // Lets the guest's browser open the order after payment without the token in a URL.
      (await cookies()).set("zv_guest_order", result.guestToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/api/marketplace/track",
        maxAge: 7 * 86400,
      });
    return Response.json({ url: result.url, orderId: result.orderId });
  } catch (e) {
    return failure(e);
  }
}
