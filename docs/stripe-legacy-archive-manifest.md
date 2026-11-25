# Stripe legacy archive manifest

Status: **executed and verified 2026-11-24 21:39:25 UTC**. Generated from a
read-only live inspection, then applied after explicit owner approval and a
fresh zero-subscription check.

## Classification

| Class | Resources | Count |
|---|---|---:|
| Canonical and required | 5 subscription products (one free), 8 add-on products, 8 subscription prices, 8 add-on prices | 29 |
| Current active subscription reference | none — the live account has zero subscriptions | 0 |
| Historical but still referenced | none | 0 |
| Obsolete and archived | 3 v3 products and 3 v3 prices below | 6 |
| Uncertain — requires investigation | none | 0 |

The canonical set is listed in [stripe-live-catalog.md](stripe-live-catalog.md).
Every canonical subscription price matches the application catalog amount,
interval, USD currency, product, and active status.

## Executed archive actions

Archived each product together with its single price. Neither resource was
deleted. No amount, customer, subscription, invoice, refund or payment history
was changed.

| # | Product ID | Product name | Price ID | Amount | Interval | Active now | Active subscriptions | Reason |
|---|---|---|---|---:|---|---|---:|---|
| 1 | `zenvio_individual_v3` | Zenvio Individual | `price_1Ub1VgQMz0wiUqo0UYVNvW7S` | $29.99 | month | no | 0 | Retired Individual plan; replaced by Starter. Unmapped in the application. |
| 2 | `zenvio_team_v3` | Zenvio Teams | `price_1Ub1VgQMz0wiUqo0jDrlP5hA` | $49.99 | month | no | 0 | Retired Teams plan; replaced by Team. Unmapped in the application. |
| 3 | `zenvio_team_extra_v3` | Zenvio Additional team seat | `price_1Ub1VhQMz0wiUqo075WFAtf9` | $9.99 | month | no | 0 | Retired extra-seat price; replaced by $5.00/$48.00 seat. Unmapped in the application. |

## Execution record

1. Re-listed all live subscriptions with status `all`: **0**.
2. Re-read each price and product: all were active and unchanged.
3. Owner approved the six resource ids in this manifest.
4. Archived the three prices, then the three products.
5. Re-read all six: `active=false`.
6. Re-read all eight canonical subscription prices: `active=true`, amounts and
   intervals unchanged.
7. Listed active products: only the 13 canonical products remain active.
8. Re-listed subscriptions: still **0**.

Nothing was deleted. No amount, customer, subscription, invoice, refund or
payment record was changed.
