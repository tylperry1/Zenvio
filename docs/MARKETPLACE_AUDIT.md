# Marketplace audit and upgrade record (Zenvio 3.0)

Baseline: `main` @ `448ff7c`, November 1, 2026. This upgrade extends the one existing marketplace; nothing was replaced or duplicated.

## Reuse versus extension

| Area | What existed | Decision |
| --- | --- | --- |
| Catalog | `private.marketplace_products`: SKU, price/cost/shipping cents, minimum quantity, stock, supplier + supplier SKU, fulfillment mode, status, image, revision, demo flag, personalization options and artwork flag (migrations 011, 015, 022). | **Reused.** Products keep their `category` text. Migration 057 adds `marketplace_categories`, which maps every existing and new category name into six product families. |
| Suppliers | `private.marketplace_suppliers`: name, website, email, fulfillment, lead time, notes, active. Admin create/edit in the marketplace console. | **Extended in place** with acquisition pipeline fields, terms, integration status and scorecard. New `supplier_contacts` and `supplier_activity` tables. Existing active suppliers are backfilled to the Active stage. |
| Storefront | `/marketplace` (signed-in), search, category tabs, cart, demo product art, checkout gate. | **Extended** with product-family navigation. It shows only families that have live products, so there are no empty categories. |
| Checkout & payments | Stripe Checkout with server-side line pricing, inventory holds, signed webhook, idempotent event table, refunds, `checkoutEnabled` setting (011, `lib/marketplace.ts`). | **Reused unchanged.** Guest checkout needs `marketplace_orders.user_id` to become optional plus a guest order-access token; not done in this pass. |
| Orders & fulfillment | Orders, order items with cost and supplier snapshot, activity log, refunds, manual `supplier_submissions` queue, customer order history. | **Reused.** Economics reporting reads these records. |
| Personalization & artwork | Product option sets, customer artwork upload (validated images), manual fulfillment coordination (`/admin/marketplace-tools`). | **Reused.** This is the base for Brand Studio, which is not built yet. |
| Supplier API | `lib/launch/printful.ts`: read-only Printful catalog behind `PRINTFUL_CATALOG_ENABLED` plus a vault key; order submission explicitly disabled. | **Reused.** The Printful supplier record links to the `printful` connector. No new live connectors (no credentials or approvals exist). |
| Pricing | Per-product retail and cost cents; legacy pricing for SaaS plans. | **New** marketplace pricing engine (`lib/market-pricing.ts`) and rules table. |
| NFC / digital cards | One demo product ("Digital contact card"). | **New** smart profiles, cards and public pages. |

## Delivered in this pass

| Feature | Status |
| --- | --- |
| Supplier acquisition pipeline (11 stages, contacts, outreach and document links, follow-ups, terms, integration status, 8-criteria scorecard, recommended targets with official websites only) at Admin → Suppliers & pricing | Completed and verified (local production build, browser end to end) |
| Pricing and profit engine: integer cents, markup vs. margin, landed cost with setup fees, processing estimate, most-specific rule resolution, suggested prices | Completed and verified (unit tests, including a sweep across costs, quantities and rules) |
| Below-cost / minimum-profit guard on activating products with a known cost | Completed and verified (API rejects below minimum, accepts valid price) |
| Pricing rules admin (global, family, category, supplier; subscriber discount field) with calculator | Completed and verified |
| Category families: six families, 47 category names, existing categories mapped | Completed and verified |
| Storefront family navigation | Completed and verified (desktop and phone, no overflow) |
| Marketplace economics: GMV, net revenue, refunds, recorded product cost with coverage, gross profit, estimated processing, contribution, by supplier and family, refund rate, supplier fees | Completed and verified (empty state; formulas reviewed). Supplier shipping cost and actual Stripe fees are not recorded yet and are labelled as such. |
| NFC smart profiles: editor, privacy toggles, links, booking button, public page, vCard, QR, permanent card links (`/c/<token>`), deactivate/reactivate, reassign, aggregate view analytics | Completed and verified (browser end to end and unit tests) |

## Not done, with reasons

| Item | Status | Reason / next step |
| --- | --- | --- |
| Live supplier connectors (order submission, tracking, webhooks) for Printful, Gelato, 4over, Printify, Prodigi | Blocked | Requires approved reseller accounts, API credentials and an authorized test order. The supplier records and integration status are in place to track this. |
| Supplier-imported catalog, variant/price sync | Partially implemented | Printful read-only catalog exists (off by default). Mapping into products is still manual. |
| Brand Studio (brand profiles, editor, templates, proofs) | Not started | Builds on the existing artwork and personalization tables. |
| Guest checkout | Completed and verified | Migration 058. Public storefront; guests give a name and email; orders get a private token (hash stored, encrypted copy for email links); order page at `/marketplace/order#token`; artwork stays account-only; guest checkout is rate-limited per client and email. |
| Saved designs, reorder, discount codes on marketplace checkout | Not started | |
| Subscriber marketplace pricing at checkout | Partially implemented | The rule field exists; checkout does not apply it yet. |
| Marketplace order emails via Resend | Implemented, awaiting Resend configuration | Confirmation, in production, shipped, delivered and refunded. Queued in the same transaction as the status change, unique per order and kind, sent with a Resend idempotency key, retried by the scheduled job. Artwork proof and delay emails are reserved kinds without a trigger yet. |
| NFC product fulfillment and encoding | Blocked | Needs a verified manufacturing partner. Customers can register their own NFC products today. |

## Gelato integration (migration 061)

Gelato is the first live supplier connector. See [GELATO_INTEGRATION.md](GELATO_INTEGRATION.md). It reuses the catalog, checkout, webhook, orders, vault, job runner and Resend infrastructure listed above; it adds Brand Studio and automated supplier fulfillment behind admin-controlled flags, and reuses the guest checkout and order emails from migration 058.
