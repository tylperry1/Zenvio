import type { PoolClient } from "pg";
import { smsSegments } from "./launch/telnyx";
import { subscriptionUsage, usageOwner } from "./subscription-usage";

/** One ledger row per accepted outbox message; retries cannot double count. */
export const smsUsageReference = (outboxId: string) => `sms:${outboxId}`;

/** Billable segments are counted only for messages the provider accepted. */
export function billableSmsSegments(text: string) {
  const value = text.trim();
  if (!value) return 0;
  return smsSegments(value);
}

/**
 * Record successfully accepted outbound segments for the workspace.
 *
 * The 300-segment SMS Starter allowance (or any plan allowance) is consumed
 * first; the remainder is recorded as billable overage. Overage *charging*
 * stays disabled until recurring add-on fulfillment is accepted, but the
 * quantity is tracked now so invoices can be reconciled later.
 *
 * Runs inside the caller's transaction and is idempotent by outbox id.
 */
export async function recordSmsSegments(
  db: PoolClient,
  input: { userId: string; outboxId: string; text: string },
) {
  const segments = billableSmsSegments(input.text);
  if (segments <= 0) return { segments: 0, included: 0, overage: 0 };

  const owner = await usageOwner(db, input.userId);
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "subscription-usage:" + owner,
  ]);
  const state = await subscriptionUsage(input.userId, db);
  const meter = state.meters.find((row) => row.meter === "smsSegments");
  const unlimited = Boolean(meter?.unlimited);
  const alreadyIncluded = Number(
    (
      await db.query(
        `SELECT coalesce(sum(included_quantity),0)::bigint n
           FROM private.subscription_usage_reservations
          WHERE billing_owner=$1 AND meter='smsSegments'
            AND period=date_trunc('month',now() at time zone 'UTC')::date
            AND state<>'released'`,
        [owner],
      )
    ).rows[0]?.n || 0,
  );
  const allowance = unlimited ? Number.MAX_SAFE_INTEGER : Number(meter?.included || 0);
  const included = unlimited
    ? segments
    : Math.max(0, Math.min(segments, allowance - alreadyIncluded));
  const overage = segments - included;

  await db.query(
    `INSERT INTO private.subscription_usage_reservations
       (billing_owner,user_id,meter,period,reference,reserved,consumed,
        included_quantity,purchased_quantity,state,settled_at)
     VALUES($1,$2,'smsSegments',date_trunc('month',now() at time zone 'UTC')::date,$3,$4,$4,$5,0,'settled',now())
     ON CONFLICT(billing_owner,meter,reference) DO NOTHING`,
    [owner, input.userId, smsUsageReference(input.outboxId), segments, included],
  );

  return { segments, included, overage };
}
