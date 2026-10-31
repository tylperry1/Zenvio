import { adminSession } from "@/lib/admin";
import { getPool } from "@/lib/db";
import { failure } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET() {
    try {
        await adminSession();
        const db = getPool();
        const [users, plans, revenue, usage, email, marketplace, security] = await Promise.all([
            db.query(`select date_trunc('day',"createdAt") day,count(*)::int signups from public."user" where "createdAt">=now()-interval '30 days' group by 1 order by 1`),
            db.query("select plan,status,count(*)::int accounts from private.subscriptions group by plan,status"),
            db.query(`select currency,count(*)::int reconciled_subscriptions,count(*) filter(where complete and mrr_cents>0)::int paying_accounts,sum(mrr_cents) filter(where complete) mrr_cents,count(*) filter(where not complete)::int incomplete from private.subscription_revenue_snapshots group by currency`),
            db.query(`select provider,model,state,count(*)::int operations,sum(input_tokens)::text input_tokens,sum(output_tokens)::text output_tokens,sum(units)::text units,sum(reserved_micros)::text reserved_micros,sum(actual_micros)::text actual_micros from private.provider_usage_reservations where created_at>=date_trunc('month',now()) group by provider,model,state`),
            db.query("select status,provider_status,count(*)::int messages from private.delivery_jobs where created_at>=now()-interval '30 days' group by status,provider_status"),
            db.query("select payment_status,count(*)::int orders,sum(total_cents)::text order_total_cents from private.marketplace_orders where created_at>=date_trunc('month',now()) group by payment_status"),
            db.query("select action,count(*)::int events from private.operation_log where created_at>=now()-interval '30 days' group by action order by events desc limit 50")
        ]);
        const coverage = (await db.query("select count(*)::int n from private.subscriptions where subscription_id is not null and status='active' and not exists(select 1 from private.subscription_revenue_snapshots r where r.user_id=subscriptions.user_id)")).rows[0].n;
        return Response.json({ generatedAt: new Date().toISOString(), signups: users.rows, plans: plans.rows, revenue: { source: "stripe_reconciled", currencies: revenue.rows, missingActiveSnapshots: coverage, complete: coverage === 0 && revenue.rows.every(r => r.incomplete === 0) }, providerUsage: usage.rows, email: email.rows, marketplace: { orders: marketplace.rows, marginCents: null, marginState: "Supplier costs are not reconciled." }, security: security.rows, retention: null, retentionState: "No cohort-retention query is implemented." }, { headers: { "Cache-Control": "no-store" } });
    }
    catch (e) {
        return failure(e);
    }
}
