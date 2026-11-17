import { getPool, databaseConfigured } from "./db";
import { providerEconomics } from "./provider-economics";
import { pricingV4PlanningCostCents, pricingV4Offers } from "./pricing-v4-catalog.mjs";
import { planningCostCents } from "./subscription-offers.mjs";

export type CostClassification = "actual" | "estimated" | "forecast" | "manual" | "unknown";

export type ProviderCostRow = {
  provider: string;
  connection: string;
  actualBilledCents: number | null;
  runningEstimateCents: number | null;
  monthlyForecastCents: number | null;
  budgetCents: number | null;
  remainingBudgetCents: number | null;
  lastSyncAt: string | null;
  lastError: string | null;
  classification: {
    actual: CostClassification;
    running: CostClassification;
    forecast: CostClassification;
  };
  notes: string;
};

function microsToCents(micros: string | number | null | undefined) {
  if (micros == null) return null;
  const n = Number(micros);
  if (!Number.isFinite(n)) return null;
  return Math.round(n / 10000);
}

export async function financialIntelligenceOverview() {
  if (!databaseConfigured()) {
    return {
      period: "unavailable",
      revenue: null,
      providers: [] as ProviderCostRow[],
      tenants: [],
      coverage:
        "Database is not configured in this environment. No financial figures are claimed.",
    };
  }

  const economics = await providerEconomics();
  const db = getPool();
  const [budgets, sync, manual, tenants] = await Promise.all([
    db.query("SELECT provider, monthly_budget_cents FROM private.provider_cost_budgets"),
    db.query(
      "SELECT provider, connection_status, last_sync_at, last_error FROM private.provider_cost_sync_state ORDER BY provider",
    ),
    db.query(
      `SELECT provider, coalesce(sum(amount_cents),0)::int cents
       FROM private.provider_cost_manual_expenses
       WHERE voided_at IS NULL
         AND period_start <= date_trunc('month', now())::date
         AND period_end >= date_trunc('month', now())::date
       GROUP BY provider`,
    ),
    db.query(
      `SELECT s.user_id, s.plan, s.status, s.seats, s.catalog_version, s.monthly_amount_cents,
              u.email, u.name
       FROM private.subscriptions s
       JOIN public."user" u ON u.id = s.user_id
       WHERE s.status IN ('active','trialing','past_due')
       ORDER BY coalesce(s.monthly_amount_cents,0) DESC
       LIMIT 200`,
    ),
  ]);

  const budgetMap = new Map(budgets.rows.map((r) => [r.provider, Number(r.monthly_budget_cents)]));
  const manualMap = new Map(manual.rows.map((r) => [r.provider, Number(r.cents)]));
  const reservationMap = new Map(
    economics.providerReservations.map((r) => [
      String(r.provider).split("/")[0] || r.provider,
      microsToCents(r.estimated_micros),
    ]),
  );
  const eventMap = new Map(
    economics.otherProviderEvents.map((r) => [
      r.provider,
      {
        estimated: microsToCents(r.estimated_micros),
        actual: microsToCents(r.actual_micros),
      },
    ]),
  );

  const providers: ProviderCostRow[] = sync.rows.map((row) => {
    const provider = row.provider as string;
    const events = eventMap.get(provider);
    const reserved = reservationMap.get(provider) ?? null;
    const manualCents = manualMap.get(provider) ?? 0;
    const actual =
      events?.actual != null
        ? events.actual + manualCents
        : manualCents > 0
          ? manualCents
          : null;
    const running =
      events?.estimated != null || reserved != null
        ? (events?.estimated || 0) + (reserved || 0) + manualCents
        : manualCents > 0
          ? manualCents
          : null;
    // Forecast is a separate projection from running burn — not summed as a third expense.
    const forecast =
      running != null
        ? Math.round(running * (new Date().getUTCDate() > 0 ? 30 / Math.max(1, new Date().getUTCDate()) : 1))
        : null;
    const budget = budgetMap.has(provider) ? budgetMap.get(provider)! : null;
    return {
      provider,
      connection: row.connection_status,
      actualBilledCents: actual,
      runningEstimateCents: running,
      monthlyForecastCents: forecast,
      budgetCents: budget,
      remainingBudgetCents:
        budget == null || running == null ? null : budget - running,
      lastSyncAt: row.last_sync_at,
      lastError: row.last_error,
      classification: {
        actual: events?.actual != null ? "actual" : manualCents > 0 ? "manual" : "unknown",
        running: "estimated",
        forecast: "forecast",
      },
      notes:
        "Actual billed, running estimate, and monthly forecast are separate views of the same period — do not add them together.",
    };
  });

  const mrr = economics.revenue.find((r) => r.currency === "usd");
  const mrrCents =
    mrr && Number(mrr.incomplete) === 0 ? Number(mrr.mrr_cents) : null;

  const tenantRows = tenants.rows.map((t) => {
    const plan = String(t.plan);
    const planning =
      pricingV4PlanningCostCents[plan as keyof typeof pricingV4PlanningCostCents] ??
      planningCostCents[plan as keyof typeof planningCostCents] ??
      0;
    const revenueCents =
      t.monthly_amount_cents != null
        ? Number(t.monthly_amount_cents)
        : plan === "team"
          ? null
          : pricingV4Offers.find((o) => o.id === plan)?.monthly ?? null;
    return {
      userId: t.user_id,
      email: t.email,
      name: t.name,
      plan,
      status: t.status,
      seats: t.seats,
      catalogVersion: t.catalog_version,
      subscriptionRevenueCents: revenueCents,
      estimatedOperatingCostCents: planning,
      estimatedContributionCents:
        revenueCents == null ? null : revenueCents - planning,
      classification: {
        revenue: t.monthly_amount_cents != null ? "actual" : "estimated",
        cost: "estimated",
      },
    };
  });

  return {
    period: economics.period,
    tagline: "Platform Financial Intelligence",
    revenue: {
      mrrCents,
      arrCents: mrrCents == null ? null : mrrCents * 12,
      incompleteSnapshots: mrr ? Number(mrr.incomplete) : null,
      classification: mrrCents == null ? "unknown" : "actual",
      source: "private.subscription_revenue_snapshots (reconciled Stripe MRR)",
    },
    planning: economics.planning,
    accountsByPlan: economics.accountsByPlan,
    anomalies: economics.anomalies,
    providers,
    tenants: tenantRows,
    proposedPlans: pricingV4Offers,
    coverage: economics.coverage,
    complete: false,
  };
}
