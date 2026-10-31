import { adminSession } from "@/lib/admin";
import { billingReadiness } from "@/lib/billing-readiness";
import { getPool } from "@/lib/db";
import { planLimits } from "@/lib/entitlement-policy";
import { pricing } from "@/lib/platform-settings";
import { failure } from "@/lib/server";
import { extraSeatOffer, individualOffer, includedFeatures, teamOffer } from "@/lib/subscription-offers.mjs";

export const dynamic = "force-dynamic";

// Read-only pricing overview for the admin console. Writes stay on the
// existing audited operations endpoint; approved package rates are code constants.
export async function GET() {
  try {
    await adminSession("pricing");
    const db = getPool();
    const [mappings, subscribers, history, early] = await Promise.all([
      db.query("SELECT plan,period,stripe_price_id FROM private.subscription_prices ORDER BY plan,period"),
      db.query(
        `SELECT coalesce(plan,'free') plan,
                count(*) FILTER (WHERE status IN ('active','trialing'))::int active,
                count(*) FILTER (WHERE status='past_due')::int past_due,
                coalesce(sum(seats) FILTER (WHERE status IN ('active','trialing')),0)::int seats
           FROM private.subscriptions GROUP BY 1`,
      ),
      db.query(
        `SELECT l.id,l.details,l.created_at,u.email actor
           FROM private.operation_log l LEFT JOIN public."user" u ON u.id=l.actor_id
          WHERE l.action='pricing_updated' ORDER BY l.created_at DESC LIMIT 20`,
      ),
      db.query("SELECT count(*)::int total, count(*) FILTER (WHERE claimed_user_id IS NULL)::int open FROM private.early_access_signups"),
    ]);
    const readiness = await billingReadiness();
    const mapped = (plan: string) =>
      mappings.rows.filter((m) => m.plan === plan).map((m) => ({ period: m.period, priceId: m.stripe_price_id }));
    const count = (plan: string) => subscribers.rows.find((r) => r.plan === plan) || { active: 0, past_due: 0, seats: 0 };
    const packages = [individualOffer, teamOffer, extraSeatOffer].map((offer) => ({
      ...offer,
      stripe: mapped(offer.id),
      subscribers: offer.id === "team_extra" ? null : count(offer.id),
    }));
    const legacy = (await pricing())
      .filter((p) => !["individual", "team", "team_extra"].includes(p.id))
      .map((p) => ({ ...p, stripe: mapped(p.id), subscribers: count(p.id) }));
    return Response.json(
      {
        readiness,
        packages,
        legacy,
        limits: { individual: planLimits.individual, team: planLimits.team },
        envelopes: { includedPerSeat: 20, overageCents: 100, overagesDefault: "off", capRangeCents: [100, 100000] },
        features: includedFeatures,
        earlyAccess: { offer: "50% off the first three monthly payments", ...early.rows[0] },
        history: history.rows,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
