import { getPool, databaseConfigured } from "./db";
import {
  CATALOG_ID,
  SELLABLE_PLANS,
  stripeProductFor,
} from "./pricing-catalog.mjs";

export type StripeMappingStatus = "synchronized" | "missing" | "mismatched";

export type PlanSyncRow = {
  plan: string;
  period: "monthly" | "annual";
  expectedCents: number;
  productId: string | null;
  stripePriceId: string | null;
  mappedCatalogVersion: string | null;
  status: StripeMappingStatus;
  note?: string;
};

export type CatalogSyncReport = {
  rows: PlanSyncRow[];
  summary: {
    synchronized: number;
    missing: number;
    mismatched: number;
  };
};

type MappingRow = {
  plan: string;
  period: string;
  stripe_price_id: string;
  stripe_product_id?: string | null;
  catalog_version: string;
};

async function mappedPrices(plans: string[]): Promise<MappingRow[]> {
  if (!databaseConfigured()) return [];
  const result = await getPool().query(
    "SELECT plan, period, stripe_price_id, stripe_product_id, catalog_version FROM private.subscription_prices WHERE plan = ANY($1::text[])",
    [plans],
  );
  return result.rows as MappingRow[];
}

/**
 * Read-only comparison of the canonical catalog against local Stripe price
 * mappings. There is one catalog, so every row is either ready, missing or
 * still pointing at a retired mapping.
 */
export async function catalogSyncReport(): Promise<CatalogSyncReport> {
  const rows = await mappedPrices(SELLABLE_PLANS.map((plan) => plan.id));
  const report: PlanSyncRow[] = [];

  for (const plan of SELLABLE_PLANS) {
    for (const period of ["monthly", "annual"] as const) {
      const expectedCents = period === "monthly" ? plan.monthly : plan.annual;
      if (expectedCents == null) continue;
      const row = rows.find((r) => r.plan === plan.id && r.period === period);
      const productId = row?.stripe_product_id || stripeProductFor(plan.id);
      if (!row?.stripe_price_id) {
        report.push({
          plan: plan.id,
          period,
          expectedCents,
          productId,
          stripePriceId: null,
          mappedCatalogVersion: null,
          status: "missing",
          note: "No Stripe price is mapped for this plan and period.",
        });
      } else if (row.catalog_version !== CATALOG_ID) {
        report.push({
          plan: plan.id,
          period,
          expectedCents,
          productId,
          stripePriceId: row.stripe_price_id,
          mappedCatalogVersion: row.catalog_version,
          status: "mismatched",
          note: "Mapping belongs to a retired catalog and must be replaced before checkout.",
        });
      } else {
        report.push({
          plan: plan.id,
          period,
          expectedCents,
          productId,
          stripePriceId: row.stripe_price_id,
          mappedCatalogVersion: row.catalog_version,
          status: "synchronized",
        });
      }
    }
  }

  return {
    rows: report,
    summary: {
      synchronized: report.filter((r) => r.status === "synchronized").length,
      missing: report.filter((r) => r.status === "missing").length,
      mismatched: report.filter((r) => r.status === "mismatched").length,
    },
  };
}
