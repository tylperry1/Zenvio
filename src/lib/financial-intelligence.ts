import { getPool, databaseConfigured } from "./db";
import { providerEconomics } from "./provider-economics";
import {
  EXTRA_SEAT,
  PLANNING_COST_CENTS,
  PLANS,
  CATALOG_ID,
  planId,
} from "./pricing-catalog.mjs";
import {
  resolveFinancialPeriod,
  type FinancialPeriod,
  type FinancialPeriodId,
} from "./financial-period";
import { latestFinancialSyncRuns, latestInvoiceSyncCoverage } from "./financial-sync";

export type CostClassification =
  | "actual"
  | "estimated"
  | "forecast"
  | "manual"
  | "mixed"
  | "unknown"
  | "verified"
  | "partial"
  | "pending"
  | "not_reconciled"
  | "unavailable";

export type ProviderCostRow = {
  provider: string;
  category: string;
  connection: string;
  actualBilledCents: number | null;
  runningEstimateCents: number | null;
  monthlyForecastCents: number | null;
  budgetCents: number | null;
  remainingBudgetCents: number | null;
  lastSyncAt: string | null;
  lastError: string | null;
  lastRecordedExpenseAt: string | null;
  unreconciledEvents: number;
  classification: {
    actual: CostClassification;
    running: CostClassification;
    forecast: CostClassification;
  };
  notes: string;
};

export type FinancialAlert = {
  id: string;
  severity: "info" | "warning" | "danger";
  title: string;
  detail: string;
  href: string;
};

const PROVIDER_CATEGORIES: Record<string, string> = {
  vercel: "Hosting",
  neon: "Database",
  database: "Database",
  stripe: "Payments",
  resend: "Email",
  anthropic: "AI",
  openai: "AI",
  gemini: "AI",
  google: "Google services",
  storage: "Storage",
  document_processing: "Documents",
  sms: "Messaging",
  telnyx: "Messaging",
  daily: "Video",
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

function planningCostForTenant(plan: string, seats: number) {
  const current = planId(plan);
  const base = PLANNING_COST_CENTS[current as keyof typeof PLANNING_COST_CENTS];
  if (base == null) return null;
  const seatCount = Number(seats) || 1;
  if (current === "business" && seatCount > 3) {
    return base + (seatCount - 3) * PLANNING_COST_CENTS.business_extra;
  }
  return base;
}

function revenueForTenant(
  plan: string,
  monthlyAmountCents: number | null,
  catalogVersion: string | null,
  seats = 1,
  snapshotMrrCents: number | null,
  snapshotComplete: boolean | null,
) {
  if (snapshotComplete && snapshotMrrCents != null) {
    return { cents: Number(snapshotMrrCents), classification: "verified" as const };
  }
  if (monthlyAmountCents != null) {
    return { cents: Number(monthlyAmountCents), classification: "actual" as const };
  }
  // Estimate from the canonical list only for canonical subscriptions. Never
  // invent revenue for a historic subscription whose Stripe amount is unknown.
  if (catalogVersion === CATALOG_ID) {
    const offer = PLANS.find((o) => o.id === plan);
    if (offer?.monthly != null) {
      const included = offer.seats ?? 1;
      const extra =
        plan === "business" && seats > included
          ? (seats - included) * EXTRA_SEAT.monthly
          : 0;
      return { cents: offer.monthly + extra, classification: "estimated" as const };
    }
  }
  return { cents: null as number | null, classification: "unknown" as const };
}

function metric(
  valueCents: number | null,
  classification: CostClassification,
  source: string,
  extras: Record<string, unknown> = {},
) {
  return { valueCents, classification, source, ...extras };
}

export async function financialIntelligenceOverview(input?: {
  periodId?: FinancialPeriodId | string | null;
  customStart?: string | null;
  customEnd?: string | null;
}) {
  let period: FinancialPeriod;
  try {
    period = resolveFinancialPeriod(input?.periodId, input?.customStart, input?.customEnd);
  } catch (e) {
    return {
      period: "invalid",
      periodMeta: null,
      revenue: null,
      cash: null,
      providers: [] as ProviderCostRow[],
      tenants: [],
      alerts: [
        {
          id: "period",
          severity: "danger" as const,
          title: "Invalid date range",
          detail: e instanceof Error ? e.message : "Unable to resolve period.",
          href: "/admin/financial-intelligence",
        },
      ],
      coverage: "Invalid period selection.",
      complete: false,
    };
  }

  if (!databaseConfigured()) {
    return {
      period: period.label,
      periodMeta: { id: period.id, start: period.start.toISOString(), end: period.end.toISOString() },
      revenue: null,
      cash: null,
      providers: [] as ProviderCostRow[],
      tenants: [],
      alerts: [
        {
          id: "db",
          severity: "danger" as const,
          title: "Database unavailable",
          detail: "Financial figures cannot be verified without a configured database.",
          href: "/admin/connections",
        },
      ],
      coverage:
        "Financial data isn’t available in this deployment. No figures are shown.",
      complete: false,
    };
  }

  const economics = await providerEconomics({ start: period.start, end: period.end });
  const db = getPool();
  const [budgets, sync, manual, tenants, planningSubs, revenueAgg, invoiceAgg, refundAgg, addonAgg, statusCounts, priceMaps, missingSnapshots, lastExpense, syncRuns, invoiceCoverage] =
    await Promise.all([
      db.query("SELECT provider, monthly_budget_cents FROM private.provider_cost_budgets"),
      db.query(
        "SELECT provider, connection_status, last_sync_at, last_error FROM private.provider_cost_sync_state ORDER BY provider",
      ),
      db.query(
        `SELECT provider, coalesce(sum(amount_cents),0)::int cents
         FROM private.provider_cost_manual_expenses
         WHERE voided_at IS NULL
           AND period_start <= (($2::timestamptz AT TIME ZONE 'UTC')::date)
           AND period_end >= (($1::timestamptz AT TIME ZONE 'UTC')::date)
         GROUP BY provider`,
        [period.start.toISOString(), period.end.toISOString()],
      ),
      db.query(
        `SELECT s.user_id, s.plan, s.status, s.seats, s.catalog_version, s.monthly_amount_cents,
                u.email, u.name,
                r.mrr_cents AS snapshot_mrr_cents, r.complete AS snapshot_complete,
                r.issue AS snapshot_issue, r.reconciled_at AS snapshot_reconciled_at,
                r.currency AS snapshot_currency
         FROM private.subscriptions s
         JOIN public."user" u ON u.id = s.user_id
         LEFT JOIN private.subscription_revenue_snapshots r ON r.user_id = s.user_id
         WHERE s.status IN ('active','trialing','past_due','unpaid','canceled')
         ORDER BY coalesce(r.mrr_cents, s.monthly_amount_cents, 0) DESC
         LIMIT 400`,
      ),
      // Platform planning uses every active Stripe-bound subscription — not the 400-row table.
      db.query(
        `SELECT plan, seats, catalog_version
         FROM private.subscriptions
         WHERE status = 'active' AND subscription_id IS NOT NULL`,
      ),
      db.query(
        `SELECT
           currency,
           coalesce(sum(mrr_cents) FILTER (WHERE complete AND status = 'active'), 0)::float AS mrr_cents,
           count(*) FILTER (WHERE complete AND status = 'active' AND mrr_cents > 0)::int AS paying_accounts,
           count(*) FILTER (WHERE complete)::int AS complete_snapshots,
           count(*) FILTER (WHERE NOT complete)::int AS incomplete,
           count(*)::int AS snapshots,
           max(reconciled_at) AS last_reconciled_at
         FROM private.subscription_revenue_snapshots
         GROUP BY currency`,
      ),
      db
        .query(
          `SELECT
             currency,
             coalesce(sum(amount_paid_cents) FILTER (
               WHERE paid AND classification IN ('cash','refunded')
                 AND coalesce(paid_at, created_at) >= $1
                 AND coalesce(paid_at, created_at) < $2
             ), 0)::int AS collected_cents,
             coalesce(sum(amount_remaining_cents) FILTER (
               WHERE status = 'open'
                 AND coalesce(paid_at, created_at) >= $1
                 AND coalesce(paid_at, created_at) < $2
             ), 0)::int AS outstanding_cents,
             count(*) FILTER (
               WHERE status = 'open'
                 AND coalesce(paid_at, created_at) >= $1
                 AND coalesce(paid_at, created_at) < $2
             )::int AS open_invoices,
             count(*) FILTER (
               WHERE (classification = 'failed' OR (attempted AND status = 'open' AND amount_remaining_cents > 0))
                 AND coalesce(paid_at, created_at) >= $1
                 AND coalesce(paid_at, created_at) < $2
             )::int AS failed_or_open_attempts,
             count(*) FILTER (
               WHERE coalesce(paid_at, created_at) >= $1 AND coalesce(paid_at, created_at) < $2
             )::int AS invoices,
             max(reconciled_at) AS last_reconciled_at
           FROM private.financial_invoice_snapshots
           WHERE coalesce(paid_at, created_at) >= $1 AND coalesce(paid_at, created_at) < $2
           GROUP BY currency`,
          [period.start.toISOString(), period.end.toISOString()],
        )
        .then((r) => ({ ok: true as const, rows: r.rows as Record<string, unknown>[] }))
        .catch(() => ({ ok: false as const, rows: [] as Record<string, unknown>[] })),
      db
        .query(
          `SELECT
             currency,
             coalesce(sum(amount_cents), 0)::int AS refunded_cents
           FROM private.financial_invoice_refund_events
           WHERE refunded_at >= $1 AND refunded_at < $2
           GROUP BY currency`,
          [period.start.toISOString(), period.end.toISOString()],
        )
        .then((r) => ({ ok: true as const, rows: r.rows as Record<string, unknown>[] }))
        .catch(() => ({ ok: false as const, rows: [] as Record<string, unknown>[] })),
      db.query(
        `SELECT
           coalesce(sum(amount_cents) FILTER (WHERE state = 'paid'), 0)::int AS addon_paid_cents,
           coalesce(sum(refunded_cents), 0)::int AS addon_refunded_cents,
           count(*) FILTER (WHERE state = 'paid')::int AS paid_orders,
           count(*) FILTER (WHERE state IN ('refunded','partially_refunded'))::int AS refunded_orders
         FROM private.subscription_addon_orders
         WHERE coalesce(paid_at, created_at) >= $1
           AND coalesce(paid_at, created_at) < $2`,
        [period.start.toISOString(), period.end.toISOString()],
      ),
      db.query(
        `SELECT status, count(*)::int AS accounts
         FROM private.subscriptions
         WHERE subscription_id IS NOT NULL
         GROUP BY status`,
      ),
      db.query(
        `SELECT plan, period, stripe_price_id, catalog_version
         FROM private.subscription_prices
         ORDER BY catalog_version, plan, period`,
      ),
      db.query(
        `SELECT count(*)::int AS n
         FROM private.subscriptions s
         WHERE s.subscription_id IS NOT NULL
           AND s.status IN ('active','trialing','past_due')
           AND NOT EXISTS (
             SELECT 1 FROM private.subscription_revenue_snapshots r WHERE r.user_id = s.user_id
           )`,
      ),
      db.query(
        `SELECT provider, max(created_at) AS last_at
         FROM private.provider_cost_manual_expenses
         WHERE voided_at IS NULL
         GROUP BY provider`,
      ).catch(() => ({ rows: [] as Record<string, unknown>[] })),
      latestFinancialSyncRuns(6).catch(() => []),
      latestInvoiceSyncCoverage().catch(() => ({
        completeCoverage: false,
        lastAt: null as string | null,
        status: null as string | null,
      })),
    ]);

  const budgetMap = new Map(budgets.rows.map((r) => [r.provider as string, Number(r.monthly_budget_cents)]));
  const manualMap = new Map(manual.rows.map((r) => [r.provider as string, Number(r.cents)]));
  const lastExpenseMap = new Map(
    lastExpense.rows.map((r) => [r.provider as string, r.last_at as string | null]),
  );
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
        unreconciled: Number(r.unreconciled || 0),
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
    const unreconciled = events?.unreconciled ?? 0;
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
    const forecast =
      meteredRunning != null
        ? Math.round(meteredRunning * (monthLength / dayOfMonth)) + manualCents
        : manualCents > 0
          ? manualCents
          : null;
    const budget = budgetMap.has(provider) ? budgetMap.get(provider)! : null;
    const actualClass: CostClassification =
      actual == null
        ? "unknown"
        : unreconciled > 0
          ? "partial"
          : meteredActual != null && manualCents > 0
            ? "mixed"
            : meteredActual != null
              ? "actual"
              : "manual";
    return {
      provider,
      category: PROVIDER_CATEGORIES[provider] || "Other",
      connection:
        syncRow?.connection_status ||
        (manualCents > 0 || budget != null ? "manual" : "unknown"),
      actualBilledCents: actual,
      runningEstimateCents: running,
      monthlyForecastCents: forecast,
      budgetCents: budget,
      remainingBudgetCents: budget == null || running == null ? null : budget - running,
      lastSyncAt: syncRow?.last_sync_at || null,
      lastError: syncRow?.last_error || null,
      lastRecordedExpenseAt: lastExpenseMap.get(provider) || null,
      unreconciledEvents: unreconciled,
      classification: {
        actual: actualClass,
        running: running == null ? "unknown" : "estimated",
        forecast: forecast == null ? "unknown" : "forecast",
      },
      notes:
        "Actual billed, running estimate, and monthly forecast are separate views of the same period — do not add them together. Forecast extrapolates metered burn only; manual expenses are included at face value. Missing invoices are unknown, not $0.",
    };
  });

  const nonUsdRevenue = revenueAgg.rows.filter(
    (r) => String(r.currency || "").toLowerCase() !== "usd",
  );
  const usdRevenue = revenueAgg.rows.find((r) => String(r.currency || "").toLowerCase() === "usd");
  const incomplete = usdRevenue ? Number(usdRevenue.incomplete) : 0;
  const completeSnapshots = usdRevenue ? Number(usdRevenue.complete_snapshots) : 0;
  const missingActive = Number(missingSnapshots.rows[0]?.n || 0);
  const reconciledMrr =
    usdRevenue && completeSnapshots > 0 ? Math.round(Number(usdRevenue.mrr_cents)) : null;
  const mrrClassification: CostClassification =
    reconciledMrr == null
      ? incomplete > 0 || missingActive > 0
        ? "not_reconciled"
        : "unknown"
      : incomplete > 0 || missingActive > 0
        ? "partial"
        : "verified";
  const mrrCents = reconciledMrr;
  const arrCents = mrrCents == null ? null : mrrCents * 12;

  const invoiceQueryOk = invoiceAgg.ok;
  const nonUsdCash = invoiceQueryOk
    ? invoiceAgg.rows.filter((r) => String(r.currency || "").toLowerCase() !== "usd")
    : [];
  const usdCash = invoiceQueryOk
    ? invoiceAgg.rows.find((r) => String(r.currency || "").toLowerCase() === "usd")
    : undefined;
  const refundQueryOk = refundAgg.ok;
  const usdRefunds = refundQueryOk
    ? refundAgg.rows.find((r) => String(r.currency || "").toLowerCase() === "usd")
    : undefined;
  const invoiceCount = usdCash ? Number(usdCash.invoices) : 0;
  const collectedCents = usdCash && invoiceCount > 0 ? Number(usdCash.collected_cents) : null;
  // Dated refund events — query failure stays unavailable (never a verified $0).
  // Successful empty invoice query may still verify a refund-only / empty period.
  const refundedCents = !refundQueryOk
    ? null
    : usdRefunds
      ? Number(usdRefunds.refunded_cents)
      : invoiceQueryOk
        ? 0
        : null;
  const outstandingCents = usdCash && invoiceCount > 0 ? Number(usdCash.outstanding_cents) : null;
  // Verified cash requires both invoice + refund queries to succeed (empty rows ≠ query failure).
  const cashCoverageComplete =
    Boolean(invoiceCoverage.completeCoverage) && refundQueryOk && invoiceQueryOk;
  const hasRefundActivity = refundedCents != null && refundedCents > 0;
  const cashClassification: CostClassification =
    invoiceCount === 0 && refundedCents == null
      ? "unavailable"
      : !cashCoverageComplete
        ? invoiceCount === 0 && !hasRefundActivity
          ? "unavailable"
          : "partial"
        : "verified";

  const addonPaid = Number(addonAgg.rows[0]?.addon_paid_cents || 0);
  const addonRefunded = Number(addonAgg.rows[0]?.addon_refunded_cents || 0);
  const addonOrders = Number(addonAgg.rows[0]?.paid_orders || 0);

  const statusMap = Object.fromEntries(
    statusCounts.rows.map((r) => [String(r.status), Number(r.accounts)]),
  ) as Record<string, number>;

  const unreconciledProviders = providers.filter((p) => p.unreconciledEvents > 0).length;
  const verifiedOperatingCents = providers.reduce((n, p) => {
    if (p.actualBilledCents == null) return n;
    if (p.classification.actual === "unknown" || p.classification.actual === "partial") return n;
    return n + p.actualBilledCents;
  }, 0);
  const providersWithActual = providers.filter((p) => p.actualBilledCents != null).length;
  const providersUnknown = providers.filter((p) => p.actualBilledCents == null).length;
  const estimatedOperatingCents = providers.reduce((n, p) => n + (p.runningEstimateCents || 0), 0);
  const operatingFullyVerified =
    providersWithActual > 0 && providersUnknown === 0 && unreconciledProviders === 0;
  const operatingVerified = providersWithActual > 0 ? verifiedOperatingCents : null;
  const operatingClassification: CostClassification =
    providersWithActual === 0
      ? "unavailable"
      : !operatingFullyVerified
        ? "partial"
        : "verified";

  // Catalog-aware planning budgets — never claim verified profit.
  const tenantRows = tenants.rows.map((t) => {
    const plan = String(t.plan);
    const seats = Number(t.seats) || 1;
    const catalogVersion = t.catalog_version == null ? null : String(t.catalog_version);
    const planning = planningCostForTenant(plan, seats);
    const snapshotMrr =
      t.snapshot_complete && t.snapshot_mrr_cents != null ? Number(t.snapshot_mrr_cents) : null;
    const revenue = revenueForTenant(
      plan,
      t.monthly_amount_cents == null ? null : Number(t.monthly_amount_cents),
      catalogVersion,
      seats,
      snapshotMrr,
      t.snapshot_complete == null ? null : Boolean(t.snapshot_complete),
    );
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
        revenue.cents == null || planning == null ? null : revenue.cents - planning,
      verifiedContributionCents: null as number | null,
      snapshotIssue: t.snapshot_issue,
      snapshotReconciledAt: t.snapshot_reconciled_at,
      classification: {
        revenue: revenue.classification,
        cost: planning == null ? ("unknown" as const) : ("estimated" as const),
        contribution: "estimated" as const,
      },
    };
  });
  // Full active Stripe-bound population (not the LIMIT 400 tenant table).
  let planningKnown = false;
  const planningCost = planningSubs.rows.reduce((n, row) => {
    const cost = planningCostForTenant(String(row.plan), Number(row.seats) || 1);
    if (cost == null) return n;
    planningKnown = true;
    return n + cost;
  }, 0);
  const planningCostValue = planningKnown && planningCost > 0 ? planningCost : null;
  const contributionEstimate =
    mrrCents == null || planningCostValue == null ? null : mrrCents - planningCostValue;
  const contributionVerified =
    mrrClassification === "verified" && operatingClassification === "verified" && operatingVerified != null
      ? mrrCents! - operatingVerified
      : null;

  // Pricing discrepancy: mapped Stripe prices vs published catalog amounts (metadata only — no Stripe mutation).
  const pricingDiscrepancies: {
    plan: string;
    period: string;
    catalogVersion: string;
    stripePriceId: string;
    issue: string;
  }[] = [];
  for (const row of priceMaps.rows) {
    if (row.catalog_version !== CATALOG_ID) continue;
    if (!PLANS.some((plan) => plan.id === row.plan)) {
      pricingDiscrepancies.push({
        plan: String(row.plan),
        period: String(row.period),
        catalogVersion: String(row.catalog_version),
        stripePriceId: String(row.stripe_price_id),
        issue: "Mapped Stripe price has no matching published catalog offer.",
      });
    }
  }

  const planDistribution = Object.entries(
    tenantRows
      .filter((t) => ["active", "trialing", "past_due"].includes(t.status))
      .reduce(
        (acc, t) => {
          acc[t.plan] = (acc[t.plan] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
  ).map(([label, value]) => ({ label, value }));

  const revenueByPlan = Object.entries(
    tenantRows
      .filter((t) => t.status === "active" && t.subscriptionRevenueCents != null)
      .reduce(
        (acc, t) => {
          acc[t.plan] = (acc[t.plan] || 0) + (t.subscriptionRevenueCents || 0);
          return acc;
        },
        {} as Record<string, number>,
      ),
  ).map(([label, value]) => ({ label, value }));

  const costByCategory = Object.entries(
    providers.reduce(
      (acc, p) => {
        const cents = p.actualBilledCents ?? p.runningEstimateCents;
        if (cents == null) return acc;
        acc[p.category] = (acc[p.category] || 0) + cents;
        return acc;
      },
      {} as Record<string, number>,
    ),
  ).map(([label, value]) => ({ label, value }));

  const payingCustomers =
    usdRevenue && completeSnapshots > 0 ? Number(usdRevenue.paying_accounts) : null;

  const alerts: FinancialAlert[] = [];
  if (missingActive > 0) {
    alerts.push({
      id: "missing-snapshots",
      severity: "warning",
      title: "Revenue snapshots missing",
      detail: `${missingActive} active/trialing/past_due subscription(s) lack a Stripe revenue snapshot. Run Stripe subscription sync.`,
      href: "/admin/financial-intelligence",
    });
  }
  if (incomplete > 0) {
    alerts.push({
      id: "incomplete-mrr",
      severity: "warning",
      title: "Incomplete MRR snapshots",
      detail: `${incomplete} snapshot(s) could not be fully reconciled (discounts, metered, mixed currency, or incomplete price data).`,
      href: "/admin/billing",
    });
  }
  if (invoiceCount === 0) {
    alerts.push({
      id: "invoices-unsynced",
      severity: "info",
      title: "Cash collections not synced",
      detail: "No invoice snapshots for this period. Collected revenue stays Unavailable until Stripe invoice sync runs.",
      href: "/admin/financial-intelligence",
    });
  } else if (!cashCoverageComplete) {
    alerts.push({
      id: "cash-partial",
      severity: "warning",
      title: "Cash totals are partial",
      detail: "Invoice snapshots exist, but the latest Stripe invoice sync did not report complete customer coverage. Collected revenue is labeled partial, not verified.",
      href: "/admin/financial-intelligence",
    });
  }
  if (nonUsdRevenue.length || nonUsdCash.length) {
    alerts.push({
      id: "non-usd",
      severity: "warning",
      title: "Non-USD amounts excluded from USD totals",
      detail: "Dashboard KPIs use USD only. Other currencies remain separate and are not converted or displayed as dollars.",
      href: "/admin/financial-intelligence",
    });
  }
  if (unreconciledProviders > 0) {
    alerts.push({
      id: "unreconciled-costs",
      severity: "warning",
      title: "Provider costs have unreconciled events",
      detail: `${unreconciledProviders} provider(s) still have usage events without actual_micros. Operating costs stay partial until those events reconcile.`,
      href: "/admin/financial-intelligence?tab=provider-costs",
    });
  }
  if (providersUnknown > 0) {
    alerts.push({
      id: "provider-gaps",
      severity: "warning",
      title: "Provider cost data incomplete",
      detail: `${providersUnknown} provider(s) have no verified invoice or manual expense this period. Missing costs are not treated as $0.`,
      href: "/admin/financial-intelligence",
    });
  }
  for (const p of providers) {
    if (p.lastError) {
      alerts.push({
        id: `sync-error-${p.provider}`,
        severity: "danger",
        title: `${p.provider} sync error`,
        detail: p.lastError,
        href: "/admin/connections",
      });
    }
    if (
      p.budgetCents != null &&
      p.runningEstimateCents != null &&
      p.runningEstimateCents >= p.budgetCents
    ) {
      alerts.push({
        id: `budget-${p.provider}`,
        severity: "danger",
        title: `${p.provider} over budget`,
        detail: "Running estimate meets or exceeds the configured monthly budget.",
        href: "/admin/financial-intelligence",
      });
    }
  }
  for (const d of pricingDiscrepancies.slice(0, 8)) {
    alerts.push({
      id: `price-${d.stripePriceId}`,
      severity: "warning",
      title: "Pricing map discrepancy",
      detail: `${d.plan} (${d.catalogVersion}/${d.period}): ${d.issue}`,
      href: "/admin/pricing",
    });
  }
  for (const a of economics.anomalies || []) {
    alerts.push({
      id: `anomaly-${a.provider}-${a.day}`,
      severity: "warning",
      title: `Unusual ${a.provider} spend`,
      detail: `Provider usage on ${a.day} exceeded the recent baseline (≥3× and ≥$0.10).`,
      href: "/admin/financial-intelligence?tab=provider-costs",
    });
  }

  const lastSync = Array.isArray(syncRuns) ? syncRuns[0] : null;

  return {
    period: period.label,
    periodMeta: {
      id: period.id,
      start: period.start.toISOString(),
      end: period.end.toISOString(),
    },
    tagline: "Platform Financial Intelligence",
    methodology: {
      mrr: "Sum of complete Stripe-reconciled subscription_revenue_snapshots for status=active. Annual prices are normalized to monthly in snapshot creation (unit_amount × qty / (interval_count × 12 for yearly)). Incomplete snapshots are excluded from the total and counted separately. Canceled subscriptions contribute $0 when complete. ARR = MRR × 12.",
      cash: "Collected revenue sums amount_paid from financial_invoice_snapshots in the selected period. Failed/open invoices are not counted as collected. Refunds are reported separately from collections.",
      contribution:
        "Estimated contribution = reconciled MRR − preliminary planning cost budgets. Verified contribution requires verified MRR and fully attributed provider actuals. Missing costs never become $0.",
    },
    kpis: {
      mrr: metric(mrrCents, mrrClassification, "private.subscription_revenue_snapshots", {
        incompleteSnapshots: incomplete,
        missingActiveSnapshots: missingActive,
        lastReconciledAt: usdRevenue?.last_reconciled_at || null,
        arrMethodology: "MRR × 12",
      }),
      arr: metric(arrCents, mrrClassification, "Derived from reconciled MRR × 12"),
      collected: metric(
        collectedCents,
        cashClassification,
        "private.financial_invoice_snapshots (Stripe invoices)",
        {
          refundedCents,
          outstandingCents,
          invoiceCount,
          lastReconciledAt: usdCash?.last_reconciled_at || invoiceCoverage.lastAt || null,
          completeCoverage: cashCoverageComplete,
          syncStatus: invoiceCoverage.status,
        },
      ),
      operatingCosts: metric(
        operatingVerified,
        operatingClassification,
        "Provider actual billed + manual expenses (never invents missing invoices)",
        {
          estimatedRunningCents: estimatedOperatingCents > 0 ? estimatedOperatingCents : null,
          providersWithActual,
          providersUnknown,
          unreconciledProviders,
        },
      ),
      estimatedContribution: metric(
        contributionEstimate,
        contributionEstimate == null ? "unavailable" : "estimated",
        "MRR − preliminary planning budgets (not verified profit)",
      ),
      verifiedContribution: metric(
        contributionVerified,
        contributionVerified == null ? "unavailable" : "verified",
        "Verified MRR − verified provider actuals",
      ),
      payingCustomers: metric(
        payingCustomers,
        payingCustomers == null ? "unknown" : mrrClassification,
        "Complete snapshots with mrr_cents > 0 and status=active",
      ),
    },
    revenue: {
      mrrCents,
      arrCents,
      incompleteSnapshots: incomplete,
      missingActiveSnapshots: missingActive,
      classification: mrrClassification,
      source: "private.subscription_revenue_snapshots (reconciled Stripe MRR)",
      lastReconciledAt: usdRevenue?.last_reconciled_at || null,
      payingCustomers,
      byPlan: revenueByPlan,
      averageRecurringRevenueCents:
        payingCustomers && payingCustomers > 0 && mrrCents != null
          ? Math.round(mrrCents / payingCustomers)
          : null,
    },
    cash: {
      collectedCents,
      refundedCents,
      outstandingCents,
      openInvoices: usdCash ? Number(usdCash.open_invoices) : null,
      failedOrOpenAttempts: usdCash ? Number(usdCash.failed_or_open_attempts) : null,
      invoiceCount,
      classification: cashClassification,
      source: "private.financial_invoice_snapshots",
      lastReconciledAt: usdCash?.last_reconciled_at || null,
      addonRevenueCents: addonOrders > 0 ? addonPaid : addonOrders === 0 ? 0 : null,
      addonRefundedCents: addonRefunded,
      addonPaidOrders: addonOrders,
      oneTimeNote:
        "Add-on checkout payments are one-time (or separately recurring add-ons) and are never included in MRR.",
    },
    subscriptions: {
      active: statusMap.active || 0,
      trialing: statusMap.trialing || 0,
      pastDue: statusMap.past_due || 0,
      canceled: statusMap.canceled || 0,
      unpaid: statusMap.unpaid || 0,
      byStatus: statusCounts.rows.map((r) => ({
        label: String(r.status),
        value: Number(r.accounts),
      })),
      planDistribution,
    },
    planning: {
      ...economics.planning,
      costCents: planningCostValue,
      costClassification: planningCostValue == null ? "unavailable" : "estimated",
      estimatedContributionCents: contributionEstimate,
      estimatedContributionMargin:
        mrrCents && mrrCents > 0 && planningCostValue != null
          ? (mrrCents - planningCostValue) / mrrCents
          : null,
      source: "Canonical-catalog preliminary planning budgets, not provider invoices",
      note:
        planningCostValue == null
          ? "No preliminary planning allocation for current active plan mix — shown as unavailable, not $0.00."
          : "Canonical-catalog preliminary planning budgets, not provider invoices",
    },
    accountsByPlan: economics.accountsByPlan,
    anomalies: economics.anomalies,
    providers,
    costByCategory,
    tenants: tenantRows.filter((t) =>
      ["active", "trialing", "past_due"].includes(t.status),
    ),
    pricing: {
      mappedPrices: priceMaps.rows,
      discrepancies: pricingDiscrepancies,
    },
    alerts,
    sync: {
      lastRun: lastSync || null,
      recentRuns: Array.isArray(syncRuns) ? syncRuns : [],
    },
    coverage: economics.coverage,
    complete: false,
  };
}
