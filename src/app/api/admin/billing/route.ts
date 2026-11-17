import { NextRequest } from "next/server";
import { adminSession } from "@/lib/admin";
import { getPool } from "@/lib/db";
import { body, sameOrigin, failure } from "@/lib/server";
import { adminBilling } from "@/lib/admin-billing";
import { currentCatalog } from "@/lib/billing-catalog";
import { catalogSyncReport } from "@/lib/pricing-sync";
import { publicPricingSurface } from "@/lib/public-pricing-surface";
import { listBillingCoupons } from "@/lib/billing-coupons";

export const maxDuration = 120;

export async function GET() {
  try {
    await adminSession();
    const db = getPool();
    const [catalog, versions, operations, sync, publicSurface, coupons] = await Promise.all([
      currentCatalog(),
      db.query("SELECT * FROM private.billing_catalog_versions ORDER BY created_at DESC LIMIT 20"),
      db.query(
        "SELECT id,action,state,result,error,updated_at FROM private.billing_admin_operations ORDER BY updated_at DESC LIMIT 30",
      ),
      catalogSyncReport(),
      publicPricingSurface(),
      listBillingCoupons(db),
    ]);
    return Response.json(
      {
        catalog,
        versions: versions.rows,
        operations: operations.rows,
        coupons,
        sync,
        publicSurface: {
          family: publicSurface.family,
          previewOnly: publicSurface.previewOnly,
          enrollment: publicSurface.enrollment,
          displayVersion: publicSurface.display.version,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    sameOrigin(req);
    const { token } = await adminSession();
    return Response.json(await adminBilling(token, await body(req)));
  } catch (e) {
    return failure(e);
  }
}
