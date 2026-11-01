import { getPool } from "./db";
import { planningCostCents } from "./subscription-offers.mjs";
/** Existing reservations remain the source of truth; no second AI spend ledger. */
export async function providerEconomics(){
 const [reservations,other,revenue,accounts]=await Promise.all([
 getPool().query(`select coalesce(model,provider) provider,count(*)::int events,
 coalesce(sum(case when state='settled' then actual_micros else reserved_micros end),0)::text estimated_micros,
 count(*) filter(where state in ('reserved','uncertain'))::int pending
 from private.provider_usage_reservations where state<>'released' and created_at>=date_trunc('month',now()) group by coalesce(model,provider) order by 1`),
 getPool().query(`select provider,count(*)::int events,sum(estimated_micros)::text estimated_micros,sum(actual_micros)::text actual_micros,
 count(*) filter(where actual_micros is null)::int unreconciled from private.provider_economic_events where period=date_trunc('month',now())::date group by provider order by provider`),
 getPool().query("select currency,sum(mrr_cents)::text mrr_cents,count(*) filter(where not complete)::int incomplete from private.subscription_revenue_snapshots group by currency"),
 getPool().query("select plan,count(*)::int accounts,coalesce(sum(greatest(seats-3,0)),0)::int additional_seats from private.subscriptions where status='active' and subscription_id is not null group by plan")
 ]);
 const planned=accounts.rows.reduce((n,r)=>n+Number(r.accounts)*(planningCostCents[r.plan as keyof typeof planningCostCents]||0)+(r.plan==='team'?Number(r.additional_seats)*planningCostCents.team_extra:0),0);
 const mrr=revenue.rows.find(r=>r.currency==='usd');
 const covered=Boolean(mrr)&&Number(mrr.incomplete)===0;
 const mrrCents=covered?Number(mrr.mrr_cents):null;
 return {period:"current UTC calendar month",providerReservations:reservations.rows,otherProviderEvents:other.rows,revenue:revenue.rows,accountsByPlan:accounts.rows,
 planning:{costCents:planned,source:"Preliminary planning budgets, not provider invoices",budgets:planningCostCents,targetContributionMargin:0.6,
 estimatedContributionMargin:mrrCents&&mrrCents>0?(mrrCents-planned)/mrrCents:null},
 complete:false,coverage:"Reservation estimates include uncertain spend. Non-reservation costs require invoice/event ingestion; missing data is unknown, not zero. Do not add overlapping provider sources. No verified total operating expense or actual contribution margin is claimed."};
}
