import { NextRequest } from "next/server";
import { adminSession } from "@/lib/admin";
import { getPool } from "@/lib/db";
import { financialIntelligenceOverview } from "@/lib/financial-intelligence";
import { runFinancialSync } from "@/lib/financial-sync";
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

export async function GET(request: NextRequest) {
  try {
    await adminSession(); // master admin only
    const url = new URL(request.url);
    const period = url.searchParams.get("period");
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    const format = url.searchParams.get("format");
    const [overview, v4] = await Promise.all([
      financialIntelligenceOverview({
        periodId: period,
        customStart: start,
        customEnd: end,
      }),
      pricingV4Settings(),
    ]);
    const payload = {
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
    };
    if (format === "csv") {
      const lines = [
        "section,metric,value_cents,classification,source",
        ...Object.entries(overview.kpis || {}).map(([key, kpi]) => {
          const row = kpi as {
            valueCents: number | null;
            classification: string;
            source: string;
          };
          return [
            "kpi",
            key,
            row.valueCents == null ? "" : String(row.valueCents),
            row.classification,
            JSON.stringify(row.source),
          ].join(",");
        }),
        ...(overview.tenants || []).map((t: {
          email: string;
          plan: string;
          subscriptionRevenueCents: number | null;
          estimatedOperatingCostCents: number | null;
          estimatedContributionCents: number | null;
          classification: { revenue: string; cost: string };
        }) =>
          [
            "tenant",
            JSON.stringify(t.email),
            t.subscriptionRevenueCents == null ? "" : String(t.subscriptionRevenueCents),
            t.classification.revenue,
            `plan=${t.plan};est_cost=${t.estimatedOperatingCostCents ?? ""};est_contribution=${t.estimatedContributionCents ?? ""}`,
          ].join(","),
        ),
      ];
      return new Response(lines.join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="zenvio-financial-intelligence.csv"',
          "Cache-Control": "no-store",
        },
      });
    }
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
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
    if (
      action === "reconcile_stripe_subscriptions" ||
      action === "reconcile_stripe_invoices" ||
      action === "reconcile_stripe_full"
    ) {
      const kind =
        action === "reconcile_stripe_subscriptions"
          ? "stripe_subscriptions"
          : action === "reconcile_stripe_invoices"
            ? "stripe_invoices"
            : "full";
      const result = await runFinancialSync(kind, token);
      await getPool().query(
        "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,$2,$3)",
        [token, "financial_intelligence_" + action, JSON.stringify({ reason, result })],
      );
      return Response.json({ ok: true, result });
    }

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
        // Enrollment is a separate control (set_pricing_v4_enrollment); this write must
        // never silently disable an already-enabled, validated launch.
        await db.query(
          `INSERT INTO private.platform_settings(key,value)
           VALUES('pricing_v4',$1)
           ON CONFLICT(key) DO UPDATE SET value=private.platform_settings.value||$1::jsonb,updated_at=now()`,
          [
            JSON.stringify({ previewEnabled, publicCatalog }),
          ],
        );
      } else if (action === "set_pricing_v4_enrollment") {
        const enabled = input.enabled === true;
        if (enabled) {
          if (input.confirm !== "ENABLE_PAID_V4_ENROLLMENT")
            throw new ApiError("Type ENABLE_PAID_V4_ENROLLMENT to confirm.", 400);
          if (process.env.PRICING_V4_VALIDATED !== "true")
            throw new ApiError("Set PRICING_V4_VALIDATED=true after Stripe test-mode acceptance.", 409);
          const { sandboxAccepted } = await import("@/lib/launch-controls");
          if (!(await sandboxAccepted()))
            throw new ApiError("Record Stripe sandbox lifecycle acceptance before enabling paid enrollment.", 409);
          const { billingReadiness } = await import("@/lib/billing-readiness");
          const readiness = await billingReadiness();
          if (!readiness.v4CheckoutEnabled)
            throw new ApiError(
              "Checkout is not ready: " + readiness.v4Blockers.join("; "),
              409,
            );
        }
        await db.query(
          `INSERT INTO private.platform_settings(key,value)
           VALUES('pricing_v4',$1)
           ON CONFLICT(key) DO UPDATE SET value=private.platform_settings.value||$1::jsonb,updated_at=now()`,
          [JSON.stringify({ enrollmentEnabled: enabled })],
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
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
