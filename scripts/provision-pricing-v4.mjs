/**
 * Idempotent Stripe test-mode provision for proposed pricing v4.
 *
 * Safety gates (all required):
 * - PRICING_V4_STRIPE_SYNC=true
 * - STRIPE_SECRET_KEY must be sk_test_…
 * - Never runs under VERCEL_ENV=production unless PRICING_V4_LIVE_SYNC_APPROVED=true
 *   (still refuses non-test keys)
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
  pricingV4Version,
} from "../src/lib/pricing-v4-catalog.mjs";
import { evaluateStripeTestModeKey } from "../src/lib/stripe-test-mode.mjs";

if (process.env.PRICING_V4_STRIPE_SYNC !== "true") {
  console.log("Pricing v4 Stripe sync skipped (set PRICING_V4_STRIPE_SYNC=true to run).");
  process.exit(0);
}

if (process.env.VERCEL_ENV === "production" && process.env.PRICING_V4_LIVE_SYNC_APPROVED !== "true") {
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

try {
  const key = await secret("STRIPE_SECRET_KEY");
  const gate = evaluateStripeTestModeKey(key);
  if (!gate.proceed) {
    console.log(gate.message);
    process.exit(gate.exitCode);
  }

  const stripe = new Stripe(key, { timeout: 15000, maxNetworkRetries: 2 });
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('subscription-catalog-v4',0))");
  try {
    for (const offer of offers) {
      const productId = `zenvio_${offer.id}_v4`;
      let product;
      try {
        product = await stripe.products.retrieve(productId);
      } catch (e) {
        if (e.code !== "resource_missing") throw e;
        product = await stripe.products.create(
          {
            id: productId,
            name: `Zenvio ${offer.name}`,
            metadata: { zenvio_offer: offer.id, catalog_version: pricingV4Version },
          },
          { idempotencyKey: productId },
        );
      }
      if (product.deleted) throw Error(`Subscription product ${productId} is deleted`);

      for (const period of ["monthly", "annual"]) {
        const amount = period === "monthly" ? offer.monthly : offer.annual;
        if (!Number.isSafeInteger(amount) || amount < 0) continue;
        if (amount === 0) continue; // Free tier has no Stripe price
        const lookup = `zenvio_${offer.id}_${period}_${amount}_v4`;
        const found = await stripe.prices.list({ lookup_keys: [lookup], limit: 10 });
        let price = found.data.find(
          (p) =>
            p.active &&
            p.currency === "usd" &&
            p.unit_amount === amount &&
            p.recurring?.interval === (period === "annual" ? "year" : "month") &&
            p.recurring.interval_count === 1,
        );
        if (!price) {
          price = await stripe.prices.create(
            {
              product: product.id,
              currency: "usd",
              unit_amount: amount,
              recurring: { interval: period === "annual" ? "year" : "month" },
              lookup_key: lookup,
              transfer_lookup_key: true,
              metadata: { zenvio_offer: offer.id, catalog_version: pricingV4Version, period },
            },
            { idempotencyKey: lookup },
          );
        }
        const prior = (
          await db.query(
            "SELECT stripe_price_id FROM private.subscription_prices WHERE plan=$1 AND period=$2 FOR UPDATE",
            [offer.id, period],
          )
        ).rows[0];
        if (prior?.stripe_price_id && prior.stripe_price_id !== price.id) {
          // Refuse to overwrite a mapping the test key cannot read (likely live Stripe IDs).
          try {
            await stripe.prices.retrieve(prior.stripe_price_id);
          } catch (e) {
            if (e.code === "resource_missing") {
              throw Error(
                `Refusing to overwrite ${offer.id}/${period} mapping ${prior.stripe_price_id} — not readable with this test key (possible live mapping). Use a disposable test database for step 3/10.`,
              );
            }
            throw e;
          }
        }
        await db.query(
          "INSERT INTO private.subscription_prices(plan,period,stripe_price_id,catalog_version) VALUES($1,$2,$3,$4) ON CONFLICT(plan,period) DO UPDATE SET stripe_price_id=excluded.stripe_price_id,catalog_version=excluded.catalog_version",
          [offer.id, period, price.id, pricingV4Version],
        );
        await db.query(
          "INSERT INTO private.subscription_price_history(stripe_price_id,plan,period,catalog_version) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [price.id, offer.id, period, pricingV4Version],
        );
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
              metadata: {
                zenvio_addon: row.id,
                zenvio_unit: row.unit,
                zenvio_recurring: String(row.recurring),
              },
            },
            { idempotencyKey: productKey },
          );
        }
        const lookup = `zenvio_addon_${row.id}_${row.amount_cents}_${row.recurring ? "mo" : "once"}`;
        const found = await stripe.prices.list({ lookup_keys: [lookup], limit: 5 });
        let price = found.data.find(
          (p) =>
            p.active &&
            p.product === product.id &&
            p.unit_amount === row.amount_cents &&
            p.currency === "usd",
        );
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
                zenvio_addon: row.id,
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
    console.log(
      `Pricing v4 test catalog mapped (${pricingV4Version}). Live enrollment remains gated until PRICING_V4_VALIDATED + enrollmentEnabled.`,
    );
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
} finally {
  db.release();
  await pool.end();
}
