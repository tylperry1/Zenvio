import { getPool, databaseConfigured } from "./db";
import { providerEconomics } from "./provider-economics";
import { pricingV4PlanningCostCents, pricingV4Offers, pricingV4Version } from "./pricing-v4-catalog.mjs";
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

function daysInUtcMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
}

function planningCostForTenant(plan: string, seats: number, catalogVersion: string | null) {
  const seatCount = Number(seats) || 1;
  if (catalogVersion === pricingV4Version) {
    const base = pricingV4PlanningCostCents[plan as keyof typeof pricingV4PlanningCostCents];
    if (base == null) return 0;
    if (plan === "business" && seatCount > 3) {
      return base + (seatCount - 3) * pricingV4PlanningCostCents.business_extra;
    }
    return base;
  }
  const base = planningCostCents[plan as keyof typeof planningCostCents];
  if (base == null) return 0;
  if (plan === "team" && seatCount > 3) {
    return base + (seatCount - 3) * planningCostCents.team_extra;
  }
  return base;
}

function revenueForTenant(
  plan: string,
  monthlyAmountCents: number | null,
  catalogVersion: string | null,
) {
  if (monthlyAmountCents != null) return { cents: Number(monthlyAmountCents), classification: "actual" as const };
  // Never backfill legacy plans with proposed v4 list prices.
  if (catalogVersion === pricingV4Version) {
    const offer = pricingV4Offers.find((o) => o.id === plan);
    if (offer?.monthly != null) return { cents: offer.monthly, classification: "estimated" as const };
  }
  return { cents: null as number | null, classification: "unknown" as const };
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
         AND period_start < (date_trunc('month', now()) + interval '1 month')::date
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

  const budgetMap = new Map(budgets.rows.map((r) => [r.provider as string, Number(r.monthly_budget_cents)]));
  const manualMap = new Map(manual.rows.map((r) => [r.provider as string, Number(r.cents)]));
  const syncMap = new Map(
    sync.rows.map((r) => [
      r.provider as string,
      {
        connection_status: r.connection_status as string,
        last_sync_at: r.last_sync_at as string | null,
        last_error: r.last_error as string | null,
      },
    ]),
  );

  // Sum model-level reservation rows that share a provider prefix (e.g. openai/gpt-4 + openai/…).
  const reservationMap = new Map<string, number>();
  for (const r of economics.providerReservations) {
    const provider = String(r.provider).split("/")[0] || String(r.provider);
    const cents = microsToCents(r.estimated_micros);
    if (cents == null) continue;
    reservationMap.set(provider, (reservationMap.get(provider) || 0) + cents);
  }

  const eventMap = new Map(
    economics.otherProviderEvents.map((r) => [
      r.provider as string,
      {
        estimated: microsToCents(r.estimated_micros),
        actual: microsToCents(r.actual_micros),
      },
    ]),
  );

  const providerIds = new Set<string>([
    ...syncMap.keys(),
    ...budgetMap.keys(),
    ...manualMap.keys(),
    ...eventMap.keys(),
    ...reservationMap.keys(),
  ]);

  const dayOfMonth = Math.max(1, new Date().getUTCDate());
  const monthLength = daysInUtcMonth();

  const providers: ProviderCostRow[] = [...providerIds].sort().map((provider) => {
    const syncRow = syncMap.get(provider);
    const events = eventMap.get(provider);
    const reserved = reservationMap.get(provider) ?? null;
    const manualCents = manualMap.get(provider) ?? 0;
    const meteredActual = events?.actual ?? null;
    const actual =
      meteredActual != null
        ? meteredActual + manualCents
        : manualCents > 0
          ? manualCents
          : null;
    const meteredRunning =
      events?.estimated != null || reserved != null
        ? (events?.estimated || 0) + (reserved || 0)
        : null;
    const running =
      meteredRunning != null
        ? meteredRunning + manualCents
        : manualCents > 0
          ? manualCents
          : null;
    // Extrapolate metered burn only; fixed manual expenses stay at their month amount.
    const forecast =
      meteredRunning != null
        ? Math.round(meteredRunning * (monthLength / dayOfMonth)) + manualCents
        : manualCents > 0
          ? manualCents
          : null;
    const budget = budgetMap.has(provider) ? budgetMap.get(provider)! : null;
    return {
      provider,
      connection: syncRow?.connection_status || (manualCents > 0 || budget != null ? "manual" : "unknown"),
      actualBilledCents: actual,
      runningEstimateCents: running,
      monthlyForecastCents: forecast,
      budgetCents: budget,
      remainingBudgetCents: budget == null || running == null ? null : budget - running,
      lastSyncAt: syncRow?.last_sync_at || null,
      lastError: syncRow?.last_error || null,
      classification: {
        actual: meteredActual != null ? "actual" : manualCents > 0 ? "manual" : "unknown",
        running: "estimated",
        forecast: "forecast",
      },
      notes:
        "Actual billed, running estimate, and monthly forecast are separate views of the same period — do not add them together. Forecast extrapolates metered burn only; manual expenses are included at face value.",
    };
  });

  const mrr = economics.revenue.find((r) => r.currency === "usd");
  const mrrCents =
    mrr && Number(mrr.incomplete) === 0 ? Number(mrr.mrr_cents) : null;

  const tenantRows = tenants.rows.map((t) => {
    const plan = String(t.plan);
    const seats = Number(t.seats) || 1;
    const catalogVersion = t.catalog_version == null ? null : String(t.catalog_version);
    const planning = planningCostForTenant(plan, seats, catalogVersion);
    const revenue = revenueForTenant(plan, t.monthly_amount_cents, catalogVersion);
    return {
      userId: t.user_id,
      email: t.email,
      name: t.name,
      plan,
      status: t.status,
      seats,
      catalogVersion,
      subscriptionRevenueCents: revenue.cents,
      estimatedOperatingCostCents: planning,
      estimatedContributionCents:
        revenue.cents == null ? null : revenue.cents - planning,
      classification: {
        revenue: revenue.classification,
        cost: "estimated" as const,
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
