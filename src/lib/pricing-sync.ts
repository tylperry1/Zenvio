import { getPool, databaseConfigured } from "./db";
import { currentCatalog, type BillingCatalog } from "./billing-catalog";
import {
  pricingV4ExtraSeat,
  pricingV4Offers,
  pricingV4Version,
} from "./pricing-v4-catalog.mjs";
import { catalogVersion as v3CatalogVersion } from "./subscription-offers.mjs";

export type StripeMappingStatus =
  | "synchronized"
  | "missing"
  | "version_mismatch"
  | "not_applicable"
  | "pending_provision";

export type PlanSyncRow = {
  plan: string;
  period: "monthly" | "annual";
  expectedCents: number | null;
  productId: string | null;
  stripePriceId: string | null;
  mappedCatalogVersion: string | null;
  status: StripeMappingStatus;
  note?: string;
};

export type CatalogSyncReport = {
  liveCatalogVersion: string;
  v3ExpectedVersion: string;
  v4ProposedVersion: string;
  live: PlanSyncRow[];
  proposedV4: PlanSyncRow[];
  summary: {
    liveSynchronized: number;
    liveMissing: number;
    liveMismatched: number;
    v4Pending: number;
  };
};

function v3ProductId(plan: string) {
  return `zenvio_${plan}_v3`;
}

function v4ProductId(plan: string) {
  return `zenvio_${plan}_v4`;
}

async function mappedPrices(plans: string[]) {
  if (!databaseConfigured()) return [] as { plan: string; period: string; stripe_price_id: string; catalog_version: string }[];
  const result = await getPool().query(
    "SELECT plan, period, stripe_price_id, catalog_version FROM private.subscription_prices WHERE plan = ANY($1::text[])",
    [plans],
  );
  return result.rows as { plan: string; period: string; stripe_price_id: string; catalog_version: string }[];
}

function classifyLive(
  offer: BillingCatalog["offers"][number],
  period: "monthly",
  row: { plan: string; period: string; stripe_price_id: string; catalog_version: string } | undefined,
  liveVersion: string,
): PlanSyncRow {
  const expectedCents = offer.monthly;
  if (!row) {
    return {
      plan: offer.id,
      period,
      expectedCents,
      productId: v3ProductId(offer.id),
      stripePriceId: null,
      mappedCatalogVersion: null,
      status: "missing",
      note: "No subscription_prices row for this plan/period.",
    };
  }
  if (row.catalog_version !== liveVersion) {
    return {
      plan: offer.id,
      period,
      expectedCents,
      productId: v3ProductId(offer.id),
      stripePriceId: row.stripe_price_id,
      mappedCatalogVersion: row.catalog_version,
      status: "version_mismatch",
      note: `Mapped catalog ${row.catalog_version} does not match live ${liveVersion}.`,
    };
  }
  return {
    plan: offer.id,
    period,
    expectedCents,
    productId: v3ProductId(offer.id),
    stripePriceId: row.stripe_price_id,
    mappedCatalogVersion: row.catalog_version,
    status: "synchronized",
  };
}

/** Read-only comparison of published catalog offers vs local Stripe price mappings. */
export async function catalogSyncReport(): Promise<CatalogSyncReport> {
  const live = await currentCatalog();
  const livePlans = live.offers.map((o) => o.id);
  const v4Plans = [
    ...pricingV4Offers.filter((o) => o.monthly != null).map((o) => o.id),
    pricingV4ExtraSeat.id,
  ];
  const rows = await mappedPrices([...new Set([...livePlans, ...v4Plans])]);

  const liveRows: PlanSyncRow[] = live.offers.map((offer) =>
    classifyLive(
      offer,
      "monthly",
      rows.find((r) => r.plan === offer.id && r.period === "monthly"),
      live.version,
    ),
  );

  const proposedV4: PlanSyncRow[] = [];
  for (const offer of pricingV4Offers) {
    if (("custom" in offer && offer.custom) || offer.monthly == null) {
      proposedV4.push({
        plan: offer.id,
        period: "monthly",
        expectedCents: null,
        productId: null,
        stripePriceId: null,
        mappedCatalogVersion: null,
        status: "not_applicable",
        note: "Custom / contact sales — no Stripe price expected.",
      });
      continue;
    }
    for (const period of ["monthly", "annual"] as const) {
      const expectedCents = period === "monthly" ? offer.monthly : offer.annual;
      if (expectedCents == null) continue;
      const row = rows.find((r) => r.plan === offer.id && r.period === period);
      if (!row || row.catalog_version !== pricingV4Version) {
        proposedV4.push({
          plan: offer.id,
          period,
          expectedCents,
          productId: v4ProductId(offer.id),
          stripePriceId: row?.stripe_price_id ?? null,
          mappedCatalogVersion: row?.catalog_version ?? null,
          status: "pending_provision",
          note: "v4 Stripe prices are not provisioned until test-mode sync is approved.",
        });
      } else {
        proposedV4.push({
          plan: offer.id,
          period,
          expectedCents,
          productId: v4ProductId(offer.id),
          stripePriceId: row.stripe_price_id,
          mappedCatalogVersion: row.catalog_version,
          status: "synchronized",
        });
      }
    }
  }
  for (const period of ["monthly", "annual"] as const) {
    const expectedCents = period === "monthly" ? pricingV4ExtraSeat.monthly : pricingV4ExtraSeat.annual;
    const row = rows.find((r) => r.plan === pricingV4ExtraSeat.id && r.period === period);
    proposedV4.push({
      plan: pricingV4ExtraSeat.id,
      period,
      expectedCents,
      productId: v4ProductId(pricingV4ExtraSeat.id),
      stripePriceId: row?.stripe_price_id ?? null,
      mappedCatalogVersion: row?.catalog_version ?? null,
      status: row?.catalog_version === pricingV4Version ? "synchronized" : "pending_provision",
      note:
        row?.catalog_version === pricingV4Version
          ? undefined
          : "v4 extra-seat Stripe price pending approved test-mode provision.",
    });
  }

  return {
    liveCatalogVersion: live.version,
    v3ExpectedVersion: v3CatalogVersion,
    v4ProposedVersion: pricingV4Version,
    live: liveRows,
    proposedV4,
    summary: {
      liveSynchronized: liveRows.filter((r) => r.status === "synchronized").length,
      liveMissing: liveRows.filter((r) => r.status === "missing").length,
      liveMismatched: liveRows.filter((r) => r.status === "version_mismatch").length,
      v4Pending: proposedV4.filter((r) => r.status === "pending_provision").length,
    },
  };
}

export function stripeProductFamily(catalogVersion: string, plan: string): string {
  if (catalogVersion === pricingV4Version || catalogVersion.startsWith("2026-11-v4")) {
    return v4ProductId(plan);
  }
  return v3ProductId(plan);
}
