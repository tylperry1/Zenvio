import { NextRequest } from "next/server";
import { adminSession } from "@/lib/admin";
import { getPool } from "@/lib/db";
import { body, sameOrigin, failure } from "@/lib/server";
import { adminBilling } from "@/lib/admin-billing";
import { catalogSyncReport } from "@/lib/pricing-sync";
import { publicPricingSurface } from "@/lib/public-pricing-surface";
import { listBillingCoupons } from "@/lib/billing-coupons";
import { listBillingAddons } from "@/lib/billing-addons";
import { listStripeWebhookEvents } from "@/lib/stripe-webhook";

export const maxDuration = 120;

export async function GET() {
  try {
    await adminSession();
    const db = getPool();
    const [operations, sync, publicSurface, coupons, addons, webhookEvents, syncRuns] =
      await Promise.all([
        db.query(
          "SELECT id,action,state,result,error,updated_at FROM private.billing_admin_operations ORDER BY updated_at DESC LIMIT 30",
        ),
        catalogSyncReport(),
        publicPricingSurface(),
        listBillingCoupons(db),
        listBillingAddons(db),
        listStripeWebhookEvents(db, 30),
        db.query(
          "SELECT id,environment,catalog_version,mode,status,summary,error,started_at,finished_at FROM private.billing_sync_runs ORDER BY started_at DESC LIMIT 10",
        ),
      ]);
    return Response.json(
      {
        operations: operations.rows,
        coupons,
        addons,
        sync,
        webhookEvents,
        syncRuns: syncRuns.rows,
        publicSurface: {
          family: publicSurface.family,
          previewOnly: publicSurface.previewOnly,
          enrollment: publicSurface.enrollment,
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
