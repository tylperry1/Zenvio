import type { PoolClient } from "pg";
import { getPool } from "./db";
import { ApiError } from "./server";
import { isV4CatalogVersion, planLimitsFor, type Plan } from "./entitlement-policy";
import { stripeClient } from "./billing";
import { billingReadiness } from "./billing-readiness";
import { isUnlimitedQuantity, UNLIMITED_SEATS_SENTINEL } from "./allowance-display";

type DB = Pick<PoolClient, "query">;
// A send belongs permanently to one billing owner, even if the sender later leaves.
export async function envelopeBudget(user: string, db: DB = getPool()) {
  const roots = (await db.query("SELECT * FROM private.team_entitlement_roots($1) ORDER BY (owner_id=$1) DESC,owner_id", [user])).rows;
  const owner: string = roots[0]?.owner_id || user;
  const row = (await db.query(`SELECT private.effective_plan($1) plan,s.plan subscription_plan,s.status,s.customer_id,s.subscription_id,s.envelope_allowance,s.catalog_version,coalesce(s.seats,1) seats,coalesce(o.enabled,false) enabled,coalesce(o.monthly_cap_cents,0) cap FROM public."user" u LEFT JOIN private.subscriptions s ON s.user_id=u.id LEFT JOIN private.envelope_overage_settings o ON o.user_id=u.id WHERE u.id=$1`, [owner])).rows[0];
  const plan = (row?.plan || "free") as Plan;
  const catalogVersion = (row?.catalog_version as string | null | undefined) || "legacy";
  const v4 = isV4CatalogVersion(catalogVersion);
  // v4 Team product is `business`. effective_plan may still surface as team/teams via
  // roots/overrides — never fall back to legacy team 30 for v4 envelopes.
  const limitsPlan: Plan =
    v4 && (plan === "team" || plan === "teams")
      ? row?.subscription_plan === "professional" ||
        row?.subscription_plan === "starter" ||
        row?.subscription_plan === "business"
        ? (row.subscription_plan as Plan)
        : ("business" as Plan)
      : plan;
  const catalogLimits = planLimitsFor(limitsPlan, catalogVersion);
  const perSeat = ["individual", "team"].includes(plan)
    ? row?.envelope_allowance ?? 20
    : catalogLimits.envelopes;
  const rawSeats = roots[0]?.seats || 1;
  const unlimitedSeats = isUnlimitedQuantity(rawSeats);
  // Never multiply catalog allowances by the unlimited-seat sentinel (int4 max).
  const seats = unlimitedSeats ? 1 : rawSeats;
  const used = (await db.query(`SELECT count(*)::int sent,coalesce(sum(charge_cents),0)::int spent FROM private.envelope_usage WHERE billing_owner=$1 AND sent_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`, [owner])).rows[0];
  const eligible =
    (["individual", "team"].includes(row?.subscription_plan) ||
      (v4 && ["starter", "professional", "business"].includes(row?.subscription_plan))) &&
    row?.status === "active" &&
    Boolean(row?.customer_id && row?.subscription_id);
  const purchased = Number((await db.query("select coalesce((select sum(quantity) from private.subscription_credit_entries where billing_owner=$1 and meter='envelopes'),0)-coalesce((select sum(purchased_quantity) from private.subscription_usage_reservations where billing_owner=$1 and meter='envelopes' and state<>'released'),0) remaining", [owner])).rows[0]?.remaining || 0);
  const pooledCatalog =
    v4 ||
    catalogVersion === "2026-11-v3" ||
    Boolean(catalogVersion?.startsWith("release-"));
  // Platform/unlimited seats keep an unlimited included pool for enforcement.
  // Display layers format the sentinel as "Unlimited"; never multiply per-seat by int4 max.
  // v4 Free=0 / Team(business)=50 are pooled catalog ceilings (not legacy seat multipliers).
  const included =
    unlimitedSeats
      ? UNLIMITED_SEATS_SENTINEL
      : v4
        ? catalogLimits.envelopes
        : pooledCatalog && ["individual", "team"].includes(plan)
          ? catalogVersion === "2026-11-v3"
            ? plan === "team"
              ? 30
              : 10
            : (row?.envelope_allowance ?? (plan === "team" ? 30 : 10))
          : perSeat * seats;
  return {
    purchasedRemaining: Math.max(0, purchased),
    creditDebt: purchased < 0,
    catalogVersion: row?.catalog_version || "legacy",
    pooled: pooledCatalog,
    owner,
    canManage: owner === user,
    plan,
    perSeat,
    seats: unlimitedSeats ? UNLIMITED_SEATS_SENTINEL : seats,
    unlimitedSeats,
    included,
    sent: used?.sent || 0,
    spent: used?.spent || 0,
    enabled: Boolean(row?.enabled),
    cap: row?.cap || 0,
    eligible,
    customer: row?.customer_id,
    subscription: row?.subscription_id,
  };
}
export function envelopeCharge(budget: { sent: number; included: number; enabled: boolean; eligible: boolean; spent: number; cap: number; unlimitedSeats?: boolean }) {
  if (budget.unlimitedSeats || isUnlimitedQuantity(budget.included)) return 0;
  if (budget.sent < budget.included) return 0;
  if (!budget.enabled || !budget.eligible) throw new ApiError("Included signing allowance reached. The billing owner can enable $1 envelope overages in Plan & billing.", 409);
  if (budget.spent + 100 > budget.cap) throw new ApiError("Monthly envelope spending limit reached. Ask the billing owner to review Plan & billing.", 409);
  return 100;
}
export async function recordEnvelopeSend(db: PoolClient, user: string, kind: "pdf" | "text", id: string) {
  let budget = await envelopeBudget(user, db);
  // Same lock as membership/seat changes; serialize shared sends and cap edits.
  for (const owner of [...new Set([user, budget.owner])].sort())
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["entitlements:" + owner]);
  const current = await envelopeBudget(user, db);
  if (current.owner !== budget.owner) throw new ApiError("Team membership changed. Please retry.", 409);
  budget = current;
  if ((await db.query("SELECT 1 FROM private.envelope_usage WHERE source_kind=$1 AND source_id=$2", [kind, id])).rowCount) return;
  let purchased = false;
  // Spend prepaid envelope credits (purchases or referral rewards) for any plan once the included pool is exhausted.
  if (!budget.unlimitedSeats && budget.sent >= budget.included) {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["subscription-usage:" + budget.owner]);
    const latest = await envelopeBudget(user, db);
    if (latest.creditDebt) throw new ApiError("Refunded signing credits require billing review before additional sends.", 409);
    if (latest.purchasedRemaining > 0) {
      await db.query("insert into private.subscription_usage_reservations(billing_owner,user_id,meter,period,reference,reserved,consumed,state,included_quantity,purchased_quantity,settled_at) values($1,$2,'envelopes',date_trunc('month',now() at time zone 'UTC')::date,$3,1,1,'settled',0,1,now())", [budget.owner, user, "envelope:" + kind + ":" + id]);
      purchased = true;
    }
  }
  const charge = purchased ? 0 : envelopeCharge(budget);
  if (charge && !(await billingReadiness()).checkoutEnabled) throw new ApiError("Envelope overage billing is not connected yet. No additional charge has been recorded.", 503);
  if (charge) {
    const stripe = await stripeClient();
    const outstanding = await stripe.invoices.list({ customer: budget.customer, status: "open", limit: 100 });
    if (outstanding.has_more || outstanding.data.some((invoice) => invoice.amount_remaining > 0 && invoice.attempted))
      throw new ApiError("Review outstanding invoices in Plan & billing before sending additional envelopes.", 409);
  }
  await db.query("INSERT INTO private.envelope_usage(source_kind,source_id,user_id,billing_owner,charge_cents,customer_id,subscription_id) VALUES($1,$2,$3,$4,$5,$6,$7)", [kind, id, user, budget.owner, charge, charge ? budget.customer : null, charge ? budget.subscription : null]);
}
