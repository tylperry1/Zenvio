/**
 * Link the already-created LIVE Stripe 2026-11-v4 catalog to Postgres.
 *
 * This script never creates, edits, or deletes Stripe objects, subscriptions,
 * invoices, or customers. It only writes the price/product mappings and the
 * add-on sync columns, after verifying every live Stripe object.
 *
 * Usage:
 *   node scripts/billing-link-live-catalog.mjs --verify   read-only comparison
 *   node scripts/billing-link-live-catalog.mjs --dry-run  verify + roll back
 *   node scripts/billing-link-live-catalog.mjs            apply transactionally
 *
 * Required:
 *   DATABASE_URL or DATABASE_URL_UNPOOLED
 *   STRIPE_SECRET_KEY (sk_live_/rk_live_) OR the encrypted integration secret
 *   INTEGRATION_ENCRYPTION_KEY when the Stripe key is stored in the database
 *
 * Run only against the production database. Preview databases must not receive
 * live Stripe IDs.
 */
import { createDecipheriv, createHash } from "node:crypto";
import { Pool } from "pg";
import Stripe from "stripe";
import { liveStripeCatalog as catalog } from "./live-stripe-catalog.mjs";
import { postgresConnectionString } from "../src/lib/postgres-connection.mjs";
import { stripeEnvironmentForKey } from "../src/lib/pricing-catalog.mjs";

const verifyOnly = process.argv.includes("--verify");
const dryRun = process.argv.includes("--dry-run");
const mode = verifyOnly ? "verify" : dryRun ? "dry-run" : "apply";
const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error(
    "Missing DATABASE_URL or DATABASE_URL_UNPOOLED. Run this where the production database connection is available.",
  );
  process.exit(2);
}

const pool = new Pool({
  connectionString: postgresConnectionString(databaseUrl),
  max: 1,
  connectionTimeoutMillis: 15000,
});
const db = await pool.connect();

async function secret(name) {
  const result = await db.query("SELECT ciphertext FROM private.integration_secrets WHERE key=$1", [name]);
  if (!result.rows[0]) return process.env[name] || "";
  if (!process.env.INTEGRATION_ENCRYPTION_KEY) {
    throw new Error("INTEGRATION_ENCRYPTION_KEY is required to read the stored Stripe key.");
  }
  const [iv, tag, data] = result.rows[0].ciphertext.split(".");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    createHash("sha256").update(process.env.INTEGRATION_ENCRYPTION_KEY).digest(),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString();
}

const problems = [];
function requireLive(condition, message) {
  if (!condition) problems.push(message);
}

async function verifySchema() {
  const tables = await db.query(
    `SELECT to_regclass('private.subscription_prices') IS NOT NULL AS prices,
            to_regclass('private.billing_addons') IS NOT NULL AS addons,
            to_regclass('private.subscription_price_history') IS NOT NULL AS history,
            to_regclass('private.billing_addon_audit') IS NOT NULL AS audit,
            to_regclass('private.billing_sync_runs') IS NOT NULL AS runs`,
  );
  const row = tables.rows[0];
  if (!row?.prices || !row?.addons || !row?.history || !row?.audit || !row?.runs) {
    throw new Error("Apply migrations 094 and 095 before linking the catalog.");
  }
  const column = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema='private' AND table_name='subscription_prices'
        AND column_name='stripe_product_id'`,
  );
  if (!column.rows.length) throw new Error("Migration 095 is missing subscription_prices.stripe_product_id.");
}

async function verifyStripe(stripe) {
  const plans = new Map();
  for (const entry of catalog.plans) {
    const product = await stripe.products.retrieve(entry.productId);
    requireLive(!product.deleted && product.active, `Stripe product ${entry.productId} is not active.`);
    requireLive(product.livemode === true, `Stripe product ${entry.productId} is not live mode.`);
    requireLive(
      product.metadata?.zenvio_plan_id === entry.plan,
      `Stripe product ${entry.productId} has the wrong zenvio_plan_id.`,
    );
    requireLive(
      product.metadata?.zenvio_catalog_version === catalog.catalogVersion,
      `Stripe product ${entry.productId} has the wrong catalog version.`,
    );

    const price = await stripe.prices.retrieve(entry.priceId);
    requireLive(price.active === true, `Stripe price ${entry.priceId} is not active.`);
    requireLive(price.livemode === true, `Stripe price ${entry.priceId} is not live mode.`);
    requireLive(price.currency === "usd", `Stripe price ${entry.priceId} is not USD.`);
    requireLive(price.unit_amount === entry.amount, `Stripe price ${entry.priceId} amount does not match.`);
    requireLive(price.product === entry.productId, `Stripe price ${entry.priceId} belongs to another product.`);
    requireLive(price.type === "recurring", `Stripe price ${entry.priceId} is not recurring.`);
    requireLive(
      price.recurring?.interval === entry.interval && price.recurring?.interval_count === 1,
      `Stripe price ${entry.priceId} interval does not match.`,
    );
    requireLive(
      price.metadata?.zenvio_billing_interval === entry.period,
      `Stripe price ${entry.priceId} has the wrong zenvio_billing_interval.`,
    );
    requireLive(
      price.metadata?.zenvio_catalog_version === catalog.catalogVersion,
      `Stripe price ${entry.priceId} has the wrong catalog version.`,
    );
    plans.set(`${entry.plan}:${entry.period}`, { product, price });
  }

  for (const entry of catalog.addons) {
    const product = await stripe.products.retrieve(entry.productId);
    requireLive(!product.deleted && product.active, `Stripe product ${entry.productId} is not active.`);
    requireLive(product.livemode === true, `Stripe product ${entry.productId} is not live mode.`);
    requireLive(
      product.metadata?.zenvio_addon_id === entry.id ||
        (entry.id === "business_extra" && product.metadata?.zenvio_plan_id === "business_extra"),
      `Stripe product ${entry.productId} has the wrong add-on metadata.`,
    );

    const price = await stripe.prices.retrieve(entry.priceId);
    requireLive(price.active === true, `Stripe price ${entry.priceId} is not active.`);
    requireLive(price.livemode === true, `Stripe price ${entry.priceId} is not live mode.`);
    requireLive(price.currency === "usd", `Stripe price ${entry.priceId} is not USD.`);
    requireLive(price.unit_amount === entry.amount, `Stripe price ${entry.priceId} amount does not match.`);
    requireLive(price.product === entry.productId, `Stripe price ${entry.priceId} belongs to another product.`);
    if (entry.recurring) {
      requireLive(price.type === "recurring", `Stripe price ${entry.priceId} must be recurring.`);
      requireLive(
        price.recurring?.interval === "month" && price.recurring?.interval_count === 1,
        `Stripe price ${entry.priceId} must recur monthly.`,
      );
    } else {
      requireLive(price.type === "one_time", `Stripe price ${entry.priceId} must be one-time.`);
    }
  }

  return plans;
}

async function currentState() {
  const prices = await db.query(
    "SELECT plan,period,stripe_price_id,stripe_product_id,catalog_version FROM private.subscription_prices",
  );
  const addons = await db.query(
    "SELECT id,amount_cents,recurring,stripe_product_id,stripe_price_id,sync_status FROM private.billing_addons",
  );
  return { prices: prices.rows, addons: addons.rows };
}

function differences(state) {
  const out = [];
  const priceMap = new Map(state.prices.map((row) => [`${row.plan}:${row.period}`, row]));
  for (const entry of catalog.plans) {
    const row = priceMap.get(`${entry.plan}:${entry.period}`);
    if (!row) {
      out.push(`${entry.plan}/${entry.period} mapping is missing.`);
      continue;
    }
    if (row.stripe_price_id !== entry.priceId) out.push(`${entry.plan}/${entry.period} price mapping is stale.`);
    if (row.stripe_product_id !== entry.productId) out.push(`${entry.plan}/${entry.period} product mapping is stale.`);
    if (row.catalog_version !== catalog.catalogVersion) out.push(`${entry.plan}/${entry.period} catalog version is stale.`);
  }
  const addonMap = new Map(state.addons.map((row) => [row.id, row]));
  for (const entry of catalog.addons) {
    const row = addonMap.get(entry.id);
    if (!row) {
      out.push(`Add-on ${entry.id} is missing.`);
      continue;
    }
    if (row.stripe_price_id !== entry.priceId) out.push(`Add-on ${entry.id} price mapping is stale.`);
    if (row.stripe_product_id !== entry.productId) out.push(`Add-on ${entry.id} product mapping is stale.`);
    if (row.sync_status !== "synced") out.push(`Add-on ${entry.id} is not marked synced.`);
    if (row.amount_cents !== entry.amount || Boolean(row.recurring) !== entry.recurring) {
      out.push(`Add-on ${entry.id} catalog terms differ from the approved mapping; refusing to overwrite.`);
    }
  }
  return out;
}

try {
  await verifySchema();
  const key = await secret("STRIPE_SECRET_KEY");
  if (!key) throw new Error("Stripe secret key is unavailable in the environment and Integration Vault.");
  const environment = stripeEnvironmentForKey(key);
  if (environment !== "live") {
    throw new Error(
      `Refusing to link live Stripe IDs with a ${environment} key. Use the live Stripe key for this catalog.`,
    );
  }

  const stripe = new Stripe(key, { timeout: 15000, maxNetworkRetries: 2 });
  await verifyStripe(stripe);
  if (problems.length) {
    console.error(JSON.stringify({ mode, ok: false, problems }, null, 2));
    process.exitCode = 1;
  } else {
    const before = await currentState();
    const pending = differences(before);

    if (verifyOnly) {
      console.log(
        JSON.stringify(
          {
            mode,
            ok: pending.length === 0,
            catalogVersion: catalog.catalogVersion,
            environment,
            plansExpected: catalog.plans.length,
            addonsExpected: catalog.addons.length,
            differences: pending,
          },
          null,
          2,
        ),
      );
      if (pending.length) process.exitCode = 1;
    } else {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('billing-live-catalog-v4',0))");
      try {
        for (const entry of catalog.plans) {
          await db.query(
            `INSERT INTO private.subscription_prices(plan,period,stripe_price_id,stripe_product_id,catalog_version)
             VALUES($1,$2,$3,$4,$5)
             ON CONFLICT(plan,period) DO UPDATE
               SET stripe_price_id=EXCLUDED.stripe_price_id,
                   stripe_product_id=EXCLUDED.stripe_product_id,
                   catalog_version=EXCLUDED.catalog_version`,
            [entry.plan, entry.period, entry.priceId, entry.productId, catalog.catalogVersion],
          );
          await db.query(
            `INSERT INTO private.subscription_price_history(stripe_price_id,plan,period,catalog_version)
             VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
            [entry.priceId, entry.plan, entry.period, catalog.catalogVersion],
          );
        }

        for (const entry of catalog.addons) {
          const row = await db.query(
            `SELECT amount_cents,recurring,stripe_product_id,stripe_price_id,sync_status
               FROM private.billing_addons WHERE id=$1 FOR UPDATE`,
            [entry.id],
          );
          if (!row.rows[0]) throw new Error(`Add-on ${entry.id} is missing from private.billing_addons.`);
          const beforeAddon = row.rows[0];
          if (beforeAddon.amount_cents !== entry.amount || Boolean(beforeAddon.recurring) !== entry.recurring) {
            throw new Error(`Add-on ${entry.id} terms differ from the approved mapping; refusing to overwrite.`);
          }
          await db.query(
            `UPDATE private.billing_addons
                SET stripe_product_id=$2,stripe_price_id=$3,sync_status='synced',
                    sync_error=NULL,last_synced_at=now(),updated_at=now()
              WHERE id=$1`,
            [entry.id, entry.productId, entry.priceId],
          );
          if (
            beforeAddon.stripe_product_id !== entry.productId ||
            beforeAddon.stripe_price_id !== entry.priceId ||
            beforeAddon.sync_status !== "synced"
          ) {
            await db.query(
              `INSERT INTO private.billing_addon_audit(addon_id,action,before_state,after_state,detail)
               VALUES($1,'stripe_catalog_link',$2::jsonb,$3::jsonb,$4::jsonb)`,
              [
                entry.id,
                JSON.stringify(beforeAddon),
                JSON.stringify({ ...beforeAddon, stripe_product_id: entry.productId, stripe_price_id: entry.priceId, sync_status: "synced" }),
                JSON.stringify({ catalogVersion: catalog.catalogVersion, source: "billing-link-live-catalog" }),
              ],
            );
          }
        }

        const after = await currentState();
        const remaining = differences(after);
        if (remaining.length) throw new Error(`Post-write verification failed: ${remaining.join(" ")}`);

        await db.query(
          `INSERT INTO private.billing_sync_runs(environment,catalog_version,mode,status,summary,finished_at)
           VALUES('live',$1,$2,'succeeded',$3,now())`,
          [
            catalog.catalogVersion,
            `link-${mode}`,
            JSON.stringify({
              plans: catalog.plans.length,
              addons: catalog.addons.length,
              source: "pre-created live Stripe catalog",
            }),
          ],
        );

        if (dryRun) {
          await db.query("ROLLBACK");
        } else {
          await db.query("COMMIT");
        }
        console.log(
          JSON.stringify(
            {
              mode,
              ok: true,
              catalogVersion: catalog.catalogVersion,
              environment,
              plansLinked: catalog.plans.length,
              addonsLinked: catalog.addons.length,
              persisted: !dryRun,
              previousDifferences: pending,
            },
            null,
            2,
          ),
        );
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      }
    }
  }
} catch (error) {
  console.error(JSON.stringify({ mode, ok: false, error: String(error?.message || error) }, null, 2));
  process.exitCode = 1;
} finally {
  db.release();
  await pool.end();
}
