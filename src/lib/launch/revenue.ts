/** Derive normalized recurring revenue from actual reconciled Stripe prices, never plan-label prices. */
export function subscriptionRevenue(subscription: {
    id: string;
    status: string;
    discounts?: unknown[];
    items: {
        data: Array<{
            quantity?: number | null;
            price: {
                currency: string;
                unit_amount: number | null;
                recurring?: {
                    interval: string;
                    interval_count: number;
                    usage_type?: string;
                } | null;
            };
        }>;
    };
}) {
    const active = subscription.status === "active", items = subscription.items.data, currencies = [...new Set(items.map(i => i.price.currency))];
    let complete = currencies.length === 1 && items.length > 0 && !subscription.discounts?.length, mrr = 0;
    for (const item of items) {
        const p = item.price, r = p.recurring;
        if (!r || !["month", "year"].includes(r.interval) || !Number.isSafeInteger(r.interval_count) || r.interval_count < 1 || r.usage_type === "metered" || p.unit_amount === null || !Number.isSafeInteger(p.unit_amount) || !Number.isInteger(item.quantity) || Number(item.quantity) < 1) {
            complete = false;
            continue;
        }
        mrr += p.unit_amount * Number(item.quantity) / (r.interval_count * (r.interval === "year" ? 12 : 1));
    }
    return { subscriptionId: subscription.id, status: subscription.status, currency: currencies.length === 1 ? currencies[0] : null, mrrCents: complete ? (active ? mrr : 0) : null, complete, issue: complete ? null : "Discounts, mixed currencies, metered pricing or incomplete price data require reconciliation." };
}
