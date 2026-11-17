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
  if (!key) {
    console.log("Pricing v4 sync pending: Stripe secret key missing.");
    process.exit(0);
  }
  if (!key.startsWith("sk_test_")) {
    console.log("Pricing v4 sync refused: Stripe secret key is not test mode (sk_test_).");
    process.exit(1);
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
