import { NextRequest } from "next/server";
import { adminSession } from "@/lib/admin";
import { getPool } from "@/lib/db";
import { financialIntelligenceOverview } from "@/lib/financial-intelligence";
import { pricingV4Settings } from "@/lib/pricing-activation";
import {
  pricingV4Addons,
  pricingV4Allowances,
  pricingV4ExtraSeat,
  pricingV4Hero,
  pricingV4Offers,
  pricingV4Tagline,
  pricingV4Version,
} from "@/lib/pricing-v4-catalog.mjs";
import { ApiError, body, failure, sameOrigin, string, integer } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await adminSession(); // master admin only
    const [overview, v4] = await Promise.all([
      financialIntelligenceOverview(),
      pricingV4Settings(),
    ]);
    return Response.json(
      {
        overview,
        pricingV4: {
          version: pricingV4Version,
          tagline: pricingV4Tagline,
          hero: pricingV4Hero,
          offers: pricingV4Offers,
          extraSeat: pricingV4ExtraSeat,
          allowances: pricingV4Allowances,
          addons: pricingV4Addons,
          settings: v4,
        },
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
    const { token } = await adminSession();
    const input = await body(request);
    const action = string(input.action, "action", 40);
    const reason = string(input.reason, "reason", 500, 5);
    const db = await getPool().connect();
    try {
      await db.query("BEGIN");
      if (action === "set_provider_budget") {
        const provider = string(input.provider, "provider", 40, 2);
        const monthlyBudgetCents = integer(input.monthlyBudgetCents, "budget", 0, 100_000_000);
        await db.query(
          `INSERT INTO private.provider_cost_budgets(provider,monthly_budget_cents,updated_by,reason)
           VALUES($1,$2,$3,$4)
           ON CONFLICT(provider) DO UPDATE SET monthly_budget_cents=$2,updated_by=$3,reason=$4,updated_at=now()`,
          [provider, monthlyBudgetCents, token, reason],
        );
      } else if (action === "add_manual_expense") {
        const provider = string(input.provider, "provider", 40, 2);
        const category = string(input.category, "category", 60, 2);
        const description = string(input.description, "description", 300, 3);
        const amountCents = integer(input.amountCents, "amount", 0, 100_000_000);
        const periodStart = string(input.periodStart, "period start", 10, 10);
        const periodEnd = string(input.periodEnd, "period end", 10, 10);
        await db.query(
          `INSERT INTO private.provider_cost_manual_expenses
           (provider,category,description,amount_cents,period_start,period_end,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [provider, category, description, amountCents, periodStart, periodEnd, token],
        );
      } else if (action === "set_pricing_v4_preview") {
        const previewEnabled = input.previewEnabled === true;
        const publicCatalog = input.publicCatalog === "v4" ? "v4" : "v3";
        if (publicCatalog === "v4" && !previewEnabled) {
          throw new ApiError("Enable preview before publishing the v4 public catalog.");
        }
        // Enrollment stays false until PRICING_V4_VALIDATED + Stripe catalog sync + owner approval.
        await db.query(
          `INSERT INTO private.platform_settings(key,value)
           VALUES('pricing_v4',$1)
           ON CONFLICT(key) DO UPDATE SET value=private.platform_settings.value||$1::jsonb,updated_at=now()`,
          [
            JSON.stringify({
              previewEnabled,
              enrollmentEnabled: false,
              publicCatalog,
            }),
          ],
        );
      } else {
        throw new ApiError("Unsupported financial intelligence action.");
      }
      await db.query(
        "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,$2,$3)",
        [token, "financial_intelligence_" + action, JSON.stringify({ reason, input })],
      );
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
    return Response.json({ ok: true, overview: await financialIntelligenceOverview() });
  } catch (e) {
    return failure(e);
  }
}
