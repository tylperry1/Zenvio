import type Stripe from "stripe";
import { databaseConfigured, getPool } from "./db";
import {
  pricingV4ExtraSeat,
  pricingV4Offers,
  pricingV4Version,
} from "./pricing-v4-catalog.mjs";

export type ReconcilePriceRow = {
  plan: string;
  period: "monthly" | "annual";
  expectedCents: number;
  priceId: string | null;
  mappedPriceId: string | null;
  status: "synchronized" | "missing" | "mismatched";
};

export type StripeCatalogReconciliation = {
  environment: "test" | "live" | "unknown";
  catalogVersion: string;
  productCount: number;
  priceCount: number;
  missingProducts: string[];
  missingPrices: string[];
  mismatched: ReconcilePriceRow[];
  duplicates: { productId: string; plan: string; interval: string; priceIds: string[] }[];
  obsoletePrices: { productId: string; priceId: string; amount: number | null; interval: string | null }[];
  addons: { id: string; productId: string | null; priceId: string | null; state: string }[];
  prices: ReconcilePriceRow[];
  checkedAt: string;
};

const productIdFor = (plan: string) => `zenvio_${plan}_v4`;

function intervalFor(period: "monthly" | "annual") {
  return period === "annual" ? "year" : "month";
}

/**
 * Compare the v4 catalog, local subscription_prices mappings, and Stripe.
 * Read-only: never creates, updates, or deletes a Stripe object.
 */
export async function reconcileStripeCatalog(
  stripe: Stripe,
  environment: "test" | "live" | "unknown",
  actor?: string,
): Promise<StripeCatalogReconciliation> {
  const offers = [
    ...pricingV4Offers.filter((offer) => offer.monthly != null && !("custom" in offer && offer.custom)),
    pricingV4ExtraSeat,
  ];
  const report: StripeCatalogReconciliation = {
    environment,
    catalogVersion: pricingV4Version,
    productCount: 0,
    priceCount: 0,
    missingProducts: [],
    missingPrices: [],
    mismatched: [],
    duplicates: [],
    obsoletePrices: [],
    addons: [],
    prices: [],
    checkedAt: new Date().toISOString(),
  };

  const mappings = databaseConfigured()
    ? (
        await getPool().query(
          "SELECT plan,period,stripe_price_id,stripe_product_id FROM private.subscription_prices WHERE catalog_version=$1",
          [pricingV4Version],
        )
      ).rows
    : [];

  for (const offer of offers) {
    const productId = productIdFor(offer.id);
    let product: Stripe.Product | null = null;
    try {
      product = await stripe.products.retrieve(productId);
      if (product.deleted) product = null;
    } catch (error) {
      if ((error as { code?: string }).code !== "resource_missing") throw error;
    }
    if (!product) {
      report.missingProducts.push(productId);
      for (const period of ["monthly", "annual"] as const) {
        const expectedCents = period === "monthly" ? offer.monthly : offer.annual;
        if (expectedCents && expectedCents > 0) {
          report.missingPrices.push(`${offer.id}/${period}`);
          report.prices.push({
            plan: offer.id,
            period,
            expectedCents,
            priceId: null,
            mappedPriceId:
              mappings.find((m) => m.plan === offer.id && m.period === period)?.stripe_price_id ??
              null,
            status: "missing",
          });
        }
      }
      continue;
    }
    report.productCount += 1;

    const active = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
    const knownAmounts = new Set<number>();
    for (const period of ["monthly", "annual"] as const) {
      const expectedCents = period === "monthly" ? offer.monthly : offer.annual;
      if (!expectedCents || expectedCents <= 0) continue;
      knownAmounts.add(expectedCents);
      const matches = active.data.filter(
        (price) =>
          price.currency === "usd" &&
          price.unit_amount === expectedCents &&
          price.recurring?.interval === intervalFor(period) &&
          price.recurring.interval_count === 1,
      );
      if (matches.length > 1) {
        report.duplicates.push({
          productId: product.id,
          plan: offer.id,
          interval: period,
          priceIds: matches.map((price) => price.id),
        });
      }
      report.priceCount += matches.length;
      const mapping =
        mappings.find((m) => m.plan === offer.id && m.period === period)?.stripe_price_id ?? null;
      if (!matches.length) {
        report.missingPrices.push(`${offer.id}/${period}`);
        report.prices.push({
          plan: offer.id,
          period,
          expectedCents,
          priceId: null,
          mappedPriceId: mapping,
          status: "missing",
        });
        continue;
      }
      const price = matches.sort((a, b) => a.created - b.created)[0];
      const status =
        !mapping || mapping !== price.id ? ("mismatched" as const) : ("synchronized" as const);
      const row: ReconcilePriceRow = {
        plan: offer.id,
        period,
        expectedCents,
        priceId: price.id,
        mappedPriceId: mapping,
        status,
      };
      if (status === "mismatched") report.mismatched.push(row);
      report.prices.push(row);
    }

    // Historical or stray active prices are reported, never deactivated.
    for (const price of active.data) {
      if (price.unit_amount != null && knownAmounts.has(price.unit_amount)) continue;
      report.obsoletePrices.push({
        productId: product.id,
        priceId: price.id,
        amount: price.unit_amount,
        interval: price.recurring?.interval ?? null,
      });
    }
  }

  if (databaseConfigured() && (await tableExists("private.billing_addons"))) {
    const rows = (
      await getPool().query(
        "SELECT id,stripe_product_id,stripe_price_id,sync_status FROM private.billing_addons ORDER BY id",
      )
    ).rows;
    for (const row of rows) {
      let state = row.sync_status as string;
      if (!row.stripe_product_id || !row.stripe_price_id) {
        state = "unmapped";
      } else {
        try {
          const [product, price] = await Promise.all([
            stripe.products.retrieve(row.stripe_product_id),
            stripe.prices.retrieve(row.stripe_price_id),
          ]);
          state = product.deleted || !price.active ? "inactive" : "synchronized";
        } catch {
          state = "missing";
        }
      }
      report.addons.push({
        id: row.id,
        productId: row.stripe_product_id,
        priceId: row.stripe_price_id,
        state,
      });
    }
  }

  if (databaseConfigured()) {
    try {
      await getPool().query(
        `INSERT INTO private.billing_sync_runs(environment,catalog_version,mode,status,summary,actor_id,finished_at)
         VALUES($1,$2,'reconcile','succeeded',$3,$4,now())`,
        [environment, pricingV4Version, JSON.stringify(report), actor ?? null],
      );
    } catch {
      /* The read-only report is still returned if history cannot be stored. */
    }
  }

  return report;
}

async function tableExists(name: string) {
  try {
    return Boolean(
      (await getPool().query("SELECT to_regclass($1) IS NOT NULL AS ready", [name])).rows[0]
        ?.ready,
    );
  } catch {
    return false;
  }
}
