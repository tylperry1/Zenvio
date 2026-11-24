/**
 * Idempotent Stripe test-mode provision for pricing v4.
 *
 * Modes:
 * - `node scripts/provision-pricing-v4.mjs --report` is read-only. It compares
 *   the catalog, the local price mappings, and Stripe, then prints a JSON report.
 * - Default mode requires PRICING_V4_STRIPE_SYNC=true and creates only missing
 *   Products/Prices. Existing prices are never deactivated or deleted.
 *
 * Safety gates:
 * - STRIPE_SECRET_KEY must be sk_test_… (never live keys from this script).
 * - Never runs under VERCEL_ENV=production without PRICING_V4_LIVE_SYNC_APPROVED=true.
 *
 * Does NOT publish a live enrollment catalog, migrate subscribers, or activate SMS.
 */
import { Pool } from "pg";
import Stripe from "stripe";
import { createDecipheriv, createHash } from "node:crypto";
import { postgresConnectionString } from "../src/lib/postgres-connection.mjs";
import {
  pricingV4ExtraSeat,
  pricingV4Offers,
  pricingV4StripeMetadata,
  pricingV4Version,
  stripeEnvironmentForKey,
} from "../src/lib/pricing-v4-catalog.mjs";
import { evaluateStripeTestModeKey } from "../src/lib/stripe-test-mode.mjs";

const reportOnly = process.argv.includes("--report");

if (!reportOnly && process.env.PRICING_V4_STRIPE_SYNC !== "true") {
  console.log("Pricing v4 Stripe sync skipped (set PRICING_V4_STRIPE_SYNC=true to run, or use --report).");
  process.exit(0);
}

if (!reportOnly && process.env.VERCEL_ENV === "production" && process.env.PRICING_V4_LIVE_SYNC_APPROVED !== "true") {
  console.log("Pricing v4 Stripe sync refused in production without PRICING_V4_LIVE_SYNC_APPROVED=true.");
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.log("Pricing v4 Stripe sync skipped: DATABASE_URL missing.");
  process.exit(0);
}

const pool = new Pool({
  connectionString: postgresConnectionString(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL),
  max: 1,
  connectionTimeoutMillis: 15000,
});
const db = await pool.connect();

async function secret(name) {
  const r = await db.query("SELECT ciphertext FROM private.integration_secrets WHERE key=$1", [name]);
  if (!r.rows[0]) return process.env[name] || "";
  if (!process.env.INTEGRATION_ENCRYPTION_KEY) throw Error("Integration encryption is not configured");
  const [iv, tag, data] = r.rows[0].ciphertext.split(".");
  const d = createDecipheriv(
    "aes-256-gcm",
    createHash("sha256").update(process.env.INTEGRATION_ENCRYPTION_KEY).digest(),
    Buffer.from(iv, "base64"),
  );
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString();
}

const offers = [
  ...pricingV4Offers.filter((o) => o.monthly != null && !o.custom),
  pricingV4ExtraSeat,
];

const productIdFor = (offer) => `zenvio_${offer.id}_v4`;
const priceLookup = (offer, period, amount) => `zenvio_${offer.id}_${period}_${amount}_v4`;
const intervalFor = (period) => (period === "annual" ? "year" : "month");

function exactPrice(prices, amount, period) {
  return prices.filter(
    (p) =>
      p.active &&
      p.currency === "usd" &&
      p.unit_amount === amount &&
      p.recurring?.interval === intervalFor(period) &&
      p.recurring.interval_count === 1,
  );
}

async function productFor(stripe, offer, environment) {
  const id = productIdFor(offer);
  let product;
  try {
    product = await stripe.products.retrieve(id);
  } catch (e) {
    if (e.code !== "resource_missing") throw e;
    product = await stripe.products.create(
      {
        id,
        name: `Zenvio ${offer.name}`,
        metadata: pricingV4StripeMetadata({
          planId: offer.id,
          environment,
          catalogVersion: pricingV4Version,
        }),
      },
      { idempotencyKey: id },
    );
  }
  if (product.deleted) throw Error(`Subscription product ${id} is deleted`);
  return product;
}

async function ensurePrice(stripe, product, offer, period, amount, environment, duplicates) {
  if (!Number.isSafeInteger(amount) || amount < 0) return null;
  if (amount === 0) return null; // Free tier has no Stripe price
  const lookup = priceLookup(offer, period, amount);
  const active = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  const matches = exactPrice(active.data, amount, period);
  if (matches.length > 1) {
    duplicates.push({
      plan: offer.id,
      period,
      amount,
      priceIds: matches.map((p) => p.id),
    });
  }
  if (matches.length) return matches.sort((a, b) => a.created - b.created)[0];

  const byLookup = await stripe.prices.list({ lookup_keys: [lookup], limit: 10 });
  const existing = exactPrice(byLookup.data, amount, period);
  if (existing.length) return existing[0];

  return stripe.prices.create(
    {
      product: product.id,
      currency: "usd",
      unit_amount: amount,
      recurring: { interval: intervalFor(period) },
      lookup_key: lookup,
      transfer_lookup_key: true,
      metadata: pricingV4StripeMetadata({
        planId: offer.id,
        interval: period,
        environment,
        catalogVersion: pricingV4Version,
      }),
    },
    { idempotencyKey: lookup },
  );
}

async function mappedRow(plan, period) {
  return (
    await db.query(
      "SELECT stripe_price_id,stripe_product_id,catalog_version FROM private.subscription_prices WHERE plan=$1 AND period=$2",
      [plan, period],
    )
  ).rows[0];
}

async function persistRun(environment, mode, status, summary, error = null) {
  try {
    await db.query(
      `INSERT INTO private.billing_sync_runs(environment,catalog_version,mode,status,summary,error,finished_at)
       VALUES($1,$2,$3,$4,$5,$6,now())`,
      [environment, pricingV4Version, mode, status, JSON.stringify(summary), error],
    );
  } catch (e) {
    console.log(`Sync run was not recorded: ${e.message}`);
  }
}

try {
  const key = await secret("STRIPE_SECRET_KEY");
  const gate = evaluateStripeTestModeKey(key);
  if (!gate.proceed) {
    console.log(gate.message);
    process.exit(gate.exitCode);
  }

  const environment = stripeEnvironmentForKey(key);
  const stripe = new Stripe(key, { timeout: 15000, maxNetworkRetries: 2 });

  if (reportOnly) {
    const report = {
      mode: "report",
      environment,
      catalogVersion: pricingV4Version,
      products: [],
      prices: [],
      missingProducts: [],
      missingPrices: [],
      mismatched: [],
      duplicates: [],
      mappingsToRepair: [],
    };
    for (const offer of offers) {
      const productId = productIdFor(offer);
      let product = null;
      try {
        product = await stripe.products.retrieve(productId);
      } catch (e) {
        if (e.code !== "resource_missing") throw e;
      }
      if (!product || product.deleted) {
        report.missingProducts.push({ plan: offer.id, productId });
        for (const period of ["monthly", "annual"]) {
          const amount = period === "monthly" ? offer.monthly : offer.annual;
          if (amount > 0) report.missingPrices.push({ plan: offer.id, period, amount, productId });
        }
        continue;
      }
      report.products.push({
        plan: offer.id,
        productId: product.id,
        name: product.name,
        planMetadata: product.metadata?.zenvio_plan_id || null,
        catalogMetadata: product.metadata?.zenvio_catalog_version || null,
      });
      const active = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
      for (const period of ["monthly", "annual"]) {
        const amount = period === "monthly" ? offer.monthly : offer.annual;
        if (!(amount > 0)) continue;
        const matches = exactPrice(active.data, amount, period);
        if (!matches.length) {
          report.missingPrices.push({ plan: offer.id, period, amount, productId });
          continue;
        }
        if (matches.length > 1) {
          report.duplicates.push({
            plan: offer.id,
            period,
            amount,
            priceIds: matches.map((p) => p.id),
          });
        }
        const price = matches[0];
        const map = await mappedRow(offer.id, period);
        report.prices.push({
          plan: offer.id,
          period,
          amount,
          priceId: price.id,
          mappedPriceId: map?.stripe_price_id || null,
          mappedProductId: map?.stripe_product_id || null,
        });
        if (!map || map.stripe_price_id !== price.id) {
          report.mismatched.push({ plan: offer.id, period, expectedPriceId: price.id, mapped: map || null });
        }
        if (map?.stripe_price_id && !map.stripe_product_id) {
          report.mappingsToRepair.push({ plan: offer.id, period, stripeProductId: product.id });
        }
      }
    }

    // Add-ons: report only, never create or alter in report mode.
    const addonTable = await db.query(
      "SELECT to_regclass('private.billing_addons') IS NOT NULL AS ready",
    );
    if (addonTable.rows[0]?.ready) {
      report.addons = [];
      const rows = (
        await db.query(
          "SELECT id,name,amount_cents,recurring,stripe_product_id,stripe_price_id,sync_status FROM private.billing_addons ORDER BY id",
        )
      ).rows;
      for (const row of rows) {
        const entry = {
          id: row.id,
          amountCents: row.amount_cents,
          recurring: row.recurring,
          productId: row.stripe_product_id,
          priceId: row.stripe_price_id,
          syncStatus: row.sync_status,
          productPresent: null,
          pricePresent: null,
          amountMatches: null,
        };
        if (row.stripe_product_id) {
          try {
            const product = await stripe.products.retrieve(row.stripe_product_id);
            entry.productPresent = !product.deleted;
          } catch {
            entry.productPresent = false;
          }
        }
        if (row.stripe_price_id) {
          try {
            const price = await stripe.prices.retrieve(row.stripe_price_id);
            entry.pricePresent = price.active;
            entry.amountMatches = price.unit_amount === row.amount_cents && price.currency === "usd";
          } catch {
            entry.pricePresent = false;
          }
        }
        report.addons.push(entry);
      }
    }

    await persistRun(environment, "report", "succeeded", report);
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  const duplicates = [];
  const synced = [];
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('subscription-catalog-v4',0))");
  try {
    for (const offer of offers) {
      const product = await productFor(stripe, offer, environment);
      for (const period of ["monthly", "annual"]) {
        const amount = period === "monthly" ? offer.monthly : offer.annual;
        const price = await ensurePrice(
          stripe,
          product,
          offer,
          period,
          amount,
          environment,
          duplicates,
        );
        if (!price) continue;

        const prior = await mappedRow(offer.id, period);
        if (prior?.stripe_price_id && prior.stripe_price_id !== price.id) {
          // Refuse to overwrite a mapping the test key cannot read (likely live Stripe IDs).
          try {
            await stripe.prices.retrieve(prior.stripe_price_id);
          } catch (e) {
            if (e.code === "resource_missing") {
              throw Error(
                `Refusing to overwrite ${offer.id}/${period} mapping ${prior.stripe_price_id} — not readable with this test key (possible live mapping). Use a disposable test database for test-mode provisioning.`,
              );
            }
            throw e;
          }
        }
        await db.query(
          `INSERT INTO private.subscription_prices(plan,period,stripe_price_id,stripe_product_id,catalog_version)
           VALUES($1,$2,$3,$4,$5)
           ON CONFLICT(plan,period) DO UPDATE
             SET stripe_price_id=excluded.stripe_price_id,
                 stripe_product_id=excluded.stripe_product_id,
                 catalog_version=excluded.catalog_version`,
          [offer.id, period, price.id, product.id, pricingV4Version],
        );
        await db.query(
          "INSERT INTO private.subscription_price_history(stripe_price_id,plan,period,catalog_version) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [price.id, offer.id, period, pricingV4Version],
        );
        synced.push({ plan: offer.id, period, amount, productId: product.id, priceId: price.id });
      }
    }

    // Also map durable add-on products/prices when the billing_addons table exists.
    const addonTable = await db.query(
      "SELECT to_regclass('private.billing_addons') IS NOT NULL AS ready",
    );
    if (addonTable.rows[0]?.ready) {
      const addons = (
        await db.query(
          "SELECT id,name,amount_cents,quantity,unit,recurring,stripe_product_id,stripe_price_id FROM private.billing_addons ORDER BY id FOR UPDATE",
        )
      ).rows;
      for (const row of addons) {
        const productKey = `zenvio_addon_${row.id}`;
        let product;
        try {
          product = await stripe.products.retrieve(row.stripe_product_id || productKey);
        } catch (e) {
          if (e.code !== "resource_missing") throw e;
          product = await stripe.products.create(
            {
              id: productKey,
              name: `Zenvio ${row.name}`,
              metadata: pricingV4StripeMetadata({
                addonId: row.id,
                environment,
                catalogVersion: pricingV4Version,
              }),
            },
            { idempotencyKey: productKey },
          );
        }
        const lookup = `zenvio_addon_${row.id}_${row.amount_cents}_${row.recurring ? "mo" : "once"}`;
        const active = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
        const exact = active.data.filter(
          (p) =>
            p.currency === "usd" &&
            p.unit_amount === row.amount_cents &&
            Boolean(p.recurring) === Boolean(row.recurring),
        );
        let price = exact.sort((a, b) => a.created - b.created)[0];
        if (exact.length > 1) {
          duplicates.push({ addon: row.id, priceIds: exact.map((p) => p.id) });
        }
        if (!price) {
          price = await stripe.prices.create(
            {
              product: product.id,
              currency: "usd",
              unit_amount: row.amount_cents,
              lookup_key: lookup,
              transfer_lookup_key: true,
              ...(row.recurring ? { recurring: { interval: "month", interval_count: 1 } } : {}),
              metadata: {
                ...pricingV4StripeMetadata({
                  addonId: row.id,
                  environment,
                  catalogVersion: pricingV4Version,
                }),
                zenvio_quantity: String(row.quantity),
                zenvio_unit: row.unit,
              },
            },
            { idempotencyKey: lookup },
          );
        }
        await db.query(
          `UPDATE private.billing_addons
              SET stripe_product_id=$2,stripe_price_id=$3,sync_status='synced',
                  sync_error=NULL,last_synced_at=now(),updated_at=now()
            WHERE id=$1`,
          [row.id, product.id, price.id],
        );
      }
      console.log(`Add-on Stripe products/prices mapped (${addons.length}). Purchase remains gated.`);
    }

    await db.query("COMMIT");
    await persistRun(environment, "provision", "succeeded", {
      environment,
      catalogVersion: pricingV4Version,
      products: [...new Set(synced.map((s) => s.productId))].length,
      prices: synced.length,
      duplicates,
      synced,
    });
    console.log(
      `Pricing v4 test catalog mapped (${pricingV4Version}, ${environment}). Duplicates detected: ${duplicates.length}. Live enrollment remains gated until PRICING_V4_VALIDATED + enrollmentEnabled.`,
    );
  } catch (error) {
    await db.query("ROLLBACK");
    await persistRun(environment, "provision", "failed", { duplicates }, String(error?.message || error).slice(0, 500));
    throw error;
  }
} finally {
  db.release();
  await pool.end();
}
