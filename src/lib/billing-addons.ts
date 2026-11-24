import type { PoolClient } from "pg";
import type Stripe from "stripe";
import { ApiError, integer, string } from "./server";
import { stripeMetadata } from "./pricing-catalog.mjs";

export type AddonSyncStatus = "synced" | "pending" | "failed" | "disabled";

export type BillingAddonRow = {
  id: string;
  name: string;
  amount_cents: number;
  quantity: string | number;
  unit: string;
  recurring: boolean;
  available: boolean;
  catalog_targets: string[];
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  sync_status: AddonSyncStatus;
  sync_error: string | null;
  updated_at?: string;
  last_synced_at?: string | null;
};

export async function listBillingAddons(db: Pick<PoolClient, "query">) {
  return (
    await db.query(
      `SELECT id,name,amount_cents,quantity,unit,recurring,available,catalog_targets,
              stripe_product_id,stripe_price_id,sync_status,sync_error,updated_at,last_synced_at
         FROM private.billing_addons
        ORDER BY recurring ASC, amount_cents ASC, id`,
    )
  ).rows as BillingAddonRow[];
}

export async function getBillingAddon(db: Pick<PoolClient, "query">, id: string) {
  return (
    await db.query("SELECT * FROM private.billing_addons WHERE id=$1", [id])
  ).rows[0] as BillingAddonRow | undefined;
}

export function parseAddonUpdate(input: Record<string, unknown>) {
  const id = string(input.addonId || input.id, "add-on id", 64, 1);
  if (!/^[a-z][a-z0-9_]{1,62}$/.test(id)) throw new ApiError("Choose a valid add-on id.");
  const patch: {
    id: string;
    name?: string;
    amountCents?: number;
    quantity?: number;
    available?: boolean;
  } = { id };
  if (input.name != null) patch.name = string(input.name, "add-on name", 120, 1);
  if (input.amountCents != null || input.amount != null) {
    patch.amountCents = integer(input.amountCents ?? input.amount, "amount (cents)", 0, 100000000);
  }
  if (input.quantity != null) {
    patch.quantity = integer(input.quantity, "quantity", 1, Number.MAX_SAFE_INTEGER);
  }
  if (typeof input.available === "boolean") patch.available = input.available;
  if (patch.name == null && patch.amountCents == null && patch.quantity == null && patch.available == null) {
    throw new ApiError("Provide at least one add-on field to update.");
  }
  return patch;
}

/** Local catalog edit. Amount changes mark sync pending until Stripe price is recreated. */
export async function updateBillingAddon(
  db: Pick<PoolClient, "query">,
  actor: string,
  input: Record<string, unknown>,
) {
  const patch = parseAddonUpdate(input);
  const before = (
    await db.query("SELECT * FROM private.billing_addons WHERE id=$1 FOR UPDATE", [patch.id])
  ).rows[0];
  if (!before) throw new ApiError("Add-on not found.", 404);

  const name = patch.name ?? before.name;
  const amount = patch.amountCents ?? before.amount_cents;
  const quantity = patch.quantity ?? Number(before.quantity);
  const available = patch.available ?? before.available;
  const amountChanged = amount !== before.amount_cents;
  const nextStatus =
    amountChanged && before.stripe_price_id
      ? "pending"
      : before.sync_status === "disabled"
        ? "disabled"
        : before.sync_status;

  const after = (
    await db.query(
      `UPDATE private.billing_addons
          SET name=$2,amount_cents=$3,quantity=$4,available=$5,
              sync_status=$6,
              stripe_price_id=CASE WHEN $7 THEN NULL ELSE stripe_price_id END,
              sync_error=CASE WHEN $7 THEN NULL ELSE sync_error END,
              updated_at=now(),updated_by=$8
        WHERE id=$1
      RETURNING *`,
      [patch.id, name, amount, quantity, available, nextStatus, amountChanged, actor],
    )
  ).rows[0];

  await db.query(
    `INSERT INTO private.billing_addon_audit(addon_id,actor_id,action,before_state,after_state,detail)
     VALUES($1,$2,'update',$3,$4,$5)`,
    [
      patch.id,
      actor,
      JSON.stringify(before),
      JSON.stringify(after),
      JSON.stringify({ amountChanged, available }),
    ],
  );
  return after as BillingAddonRow;
}

/**
 * Create/update Stripe Product + Price for an add-on.
 * Amount changes create a new price (Stripe prices are immutable).
 * Does not flip ADDON_BILLING_VALIDATED or enable customer checkout.
 */
export async function syncAddonToStripe(
  db: Pick<PoolClient, "query">,
  stripe: Stripe,
  addonId: string,
  actor: string,
  environment: "test" | "live" | "unknown" = "unknown",
) {
  const row = (
    await db.query("SELECT * FROM private.billing_addons WHERE id=$1 FOR UPDATE", [addonId])
  ).rows[0];
  if (!row) throw new ApiError("Add-on not found.", 404);
  if (row.sync_status === "disabled") {
    throw new ApiError("Disabled add-ons cannot be synchronized.", 409);
  }

  const productKey = `zenvio_addon_${row.id}`;
  const stripeKeyBase = `zenvio-billing-addon-${row.id}`;

  try {
    let productId = row.stripe_product_id as string | null;
    if (!productId) {
      try {
        const existing = await stripe.products.retrieve(productKey);
        if (!existing.deleted) productId = existing.id;
      } catch (e: unknown) {
        const err = e as { code?: string };
        if (err.code !== "resource_missing") throw e;
      }
    }
    if (!productId) {
      const product = await stripe.products.create(
        {
          id: productKey,
          name: `Zenvio ${row.name}`,
          metadata: {
            ...stripeMetadata({ addonId: row.id, environment }),
            zenvio_unit: row.unit,
            zenvio_recurring: String(row.recurring),
          },
        },
        { idempotencyKey: `${stripeKeyBase}-product` },
      );
      productId = product.id;
    } else {
      await stripe.products.update(productId, {
        name: `Zenvio ${row.name}`,
        metadata: {
          ...stripeMetadata({ addonId: row.id, environment }),
          zenvio_unit: row.unit,
          zenvio_recurring: String(row.recurring),
        },
      });
    }

    let priceId = row.stripe_price_id as string | null;
    if (priceId) {
      const price = await stripe.prices.retrieve(priceId);
      if (
        price.unit_amount !== row.amount_cents ||
        price.currency !== "usd" ||
        Boolean(price.recurring) !== Boolean(row.recurring) ||
        !price.active
      ) {
        priceId = null;
      }
    }

    if (!priceId) {
      const lookup = `zenvio_addon_${row.id}_${row.amount_cents}_${row.recurring ? "mo" : "once"}`;
      const found = await stripe.prices.list({ lookup_keys: [lookup], limit: 5 });
      const match = found.data.find(
        (p) =>
          p.product === productId &&
          p.unit_amount === row.amount_cents &&
          p.currency === "usd" &&
          p.active,
      );
      if (match) {
        priceId = match.id;
      } else {
        const price = await stripe.prices.create(
          {
            product: productId,
            currency: "usd",
            unit_amount: row.amount_cents,
            lookup_key: lookup,
            transfer_lookup_key: true,
            ...(row.recurring
              ? { recurring: { interval: "month" as const, interval_count: 1 } }
              : {}),
            metadata: {
              ...stripeMetadata({ addonId: row.id, environment }),
              zenvio_quantity: String(row.quantity),
              zenvio_unit: row.unit,
            },
          },
          { idempotencyKey: `${stripeKeyBase}-price-${row.amount_cents}-${row.recurring ? "mo" : "once"}` },
        );
        priceId = price.id;
      }
    }

    const synced = (
      await db.query(
        `UPDATE private.billing_addons
            SET stripe_product_id=$2,stripe_price_id=$3,sync_status='synced',
                sync_error=NULL,last_synced_at=now(),updated_at=now(),updated_by=$4
          WHERE id=$1 RETURNING *`,
        [addonId, productId, priceId, actor],
      )
    ).rows[0];

    await db.query(
      `INSERT INTO private.billing_addon_audit(addon_id,actor_id,action,after_state,detail)
       VALUES($1,$2,'sync_succeeded',$3,$4)`,
      [
        addonId,
        actor,
        JSON.stringify(synced),
        JSON.stringify({ productId, priceId }),
      ],
    );
    return synced as BillingAddonRow;
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 500) : "Stripe add-on synchronization failed.";
    await db.query(
      `UPDATE private.billing_addons
          SET sync_status='failed',sync_error=$2,updated_at=now(),updated_by=$3
        WHERE id=$1`,
      [addonId, message, actor],
    );
    await db.query(
      `INSERT INTO private.billing_addon_audit(addon_id,actor_id,action,detail)
       VALUES($1,$2,'sync_failed',$3)`,
      [addonId, actor, JSON.stringify({ error: message })],
    );
    throw error instanceof ApiError
      ? error
      : new ApiError(
          `Stripe add-on synchronization failed: ${message}. Retry after resolving the provider error.`,
          503,
        );
  }
}

export async function syncAllAddonsToStripe(
  db: Pick<PoolClient, "query">,
  stripe: Stripe,
  actor: string,
  environment: "test" | "live" | "unknown" = "unknown",
) {
  const rows = await listBillingAddons(db);
  const results: { id: string; syncStatus: string; error?: string }[] = [];
  for (const row of rows) {
    if (row.sync_status === "disabled") {
      results.push({ id: row.id, syncStatus: "disabled" });
      continue;
    }
    try {
      const synced = await syncAddonToStripe(db, stripe, row.id, actor, environment);
      results.push({ id: row.id, syncStatus: synced.sync_status });
    } catch (e) {
      results.push({
        id: row.id,
        syncStatus: "failed",
        error: e instanceof Error ? e.message : "sync failed",
      });
    }
  }
  return results;
}
