# Gelato integration

Gelato supplies products and fulfillment. Zenvio administrators control the catalog: nothing is imported, published or produced without explicit admin action and verified payment.

## What was reused vs. extended

| Area | Existing | Change |
| --- | --- | --- |
| Credentials | Encrypted integration vault (AES-256-GCM) and Connections page | `GELATO_API_KEY` added as a vault field; Gelato card in Connections. `GELATO_API_KEY` env var is only a fallback. |
| Supplier record | `marketplace_suppliers` pipeline | Gelato row (connector `gelato`). Its `active` flag gates storefront visibility of all Gelato listings. |
| Catalog | `marketplace_products`, categories, families | Imported products are ordinary `marketplace_products` rows (`fulfillment='print_on_demand'`) plus `supplier_products` / `supplier_variants`. |
| Pricing | `market-pricing.ts`, `marketplace_pricing_rules` | Added minimum margin, minimum retail and product-level overrides; supplier-scope rule for Gelato. |
| Customization | Personalization options + artwork uploads | Brand Studio (`brand_assets`, `saved_designs`, `design_proofs`). Existing personalization is unchanged. |
| Checkout | `createMarketCheckout` + Stripe Checkout + signed webhook; public guest checkout from migration 058 | Same function, webhook and guest model (`user_id IS NULL`, fragment token). Gelato lines add address-before-payment, live quote and profit revalidation. |
| Orders | `marketplace_orders`, items, activity, refunds | Added order number, supplier cost columns, item design/print-file snapshot; `supplier_orders`, shipments, events. |
| Background work | Scheduled job runner (GitHub Actions, every 5 min) | `processMarketplaceJobs` (submission, sync, email, daily product refresh) with contained failures. |
| Email | Resend sender and the `marketplace_order_emails` queue (migration 058, `market-mail.ts`) | Gelato events queue `in_production`, `shipped`, `delivered` and `delayed` emails there (one per order and kind). Admin alerts use a separate `marketplace_admin_alerts` table. |

## Gelato API usage

Authentication: `X-API-KEY` header (server-side only). Endpoints (`src/lib/gelato/core.ts`):

| Purpose | Request |
| --- | --- |
| Connection test, catalog list | `GET https://product.gelatoapis.com/v3/catalogs` |
| Catalog attributes | `GET /v3/catalogs/{catalogUid}` |
| Product search (admin browser) | `POST /v3/catalogs/{catalogUid}/products:search` |
| Product detail | `GET /v3/products/{productUid}` |
| Prices (USD, US) | `GET /v3/products/{productUid}/prices?country=US&currency=USD` |
| Checkout quote | `POST https://order.gelatoapis.com/v4/orders:quote` |
| Create order | `POST /v4/orders` (`orderReferenceId = zenvio-<order id>`) |
| Lookup before retry | `POST /v4/orders:search` |
| Status/tracking | `GET /v4/orders/{id}` |
| Cancel | `POST /v4/orders/{id}:cancel` |

The build sandbox could not reach `dashboard.gelato.com`, so endpoint paths follow Gelato's published API reference as known at implementation time and were corroborated by secondary sources. Responses are parsed defensively (unknown data is dropped, never invented). **Confirm each endpoint with the live key during activation** (step 2 below); any mismatch surfaces as a logged `invalid_response`/`rejected` error, never as fabricated data.

Price rows are treated as totals for their quantity (unit = total ÷ quantity). Catalog prices are estimates; the checkout quote is authoritative and is re-checked against profit rules before payment.

## Safety properties (tested)

- Connecting never imports; import requires explicit selection and creates drafts; the same Gelato product ID cannot be imported twice.
- Sync never overwrites names, descriptions, categories, images, retail overrides or rules.
- A product whose fixed retail price no longer meets its rule is paused and admins are alerted. Rule-priced products re-price automatically; admins are alerted to cost increases.
- Supplier orders are created only after a verified Stripe payment, under a row lock. Timeouts, network errors, 5xx and 429 mark the order `uncertain`; the next attempt searches Gelato by reference before resubmitting. Definitive rejections go to the manual review queue.
- Refunds before submission cancel fulfillment; refunds after submission alert admins to cancel at Gelato.
- Print files are server-rendered PDFs at the supplier's physical size; Gelato downloads them through HMAC-signed, expiring URLs. Unapproved designs are never linked.
- Artwork is private (owner or marketplace admin only). SVGs with scripts, entities or external references are rejected; remote URLs are never fetched.
- Guest orders use the existing private-token model (hash for lookup, encrypted copy for email links, token only in URL fragments). The "find your order" lookup emails the link, is rate-limited, and never reveals whether an order exists. Guest Brand Studio work is bound to a hashed httpOnly browser token.
- The Gelato webhook requires a secret URL token (stored hashed) and re-fetches order state from the API; payload status is never trusted. Events are deduplicated.
- Customer responses and emails never include supplier costs or supplier identifiers.

## Activation checklist (production)

Live purchasing stays disabled until every step is complete.

1. **Key**: Admin → Connections → Gelato → save the API key (vault). Do not paste it anywhere else.
2. **Connection**: Admin → Commerce → Gelato → Test connection. Expect "Connected" and a catalog count. Check Sync & logs for errors.
3. **Enable** (master admin): turn on *Gelato integration*.
4. **Import**: Product browser → choose a catalog and filters → select specific products → import (group sizes/colors into one listing). Repeat for each launch product.
5. **Review each draft**: name, description (≥20 chars), category, photo, production estimate, options, retail pricing; **print areas from Gelato's product specification** (width/height/bleed in mm, file type `default`/`back`…). Preview the listing, then Publish.
6. **Pricing**: set the Gelato rule (markup, minimum margin, minimum profit). Verify no option shows a pricing violation.
7. **Webhook** (optional, recommended): Generate webhook URL → add it in Gelato's dashboard for order status and tracking events. Without it, status is polled every scheduled run.
8. **Supervised test order**: with a Stripe test key and marketplace webhook configured, open marketplace checkout (Admin → Marketplace settings), then turn on *Live fulfillment* and place one order. Gelato's order API supports draft orders; if a real test order is placed, cancel it in Gelato before production. Confirm: quote shown, order paid, `supplier_orders` submitted, print file downloaded by Gelato, status/tracking updates, emails received.
9. **Pause** at any time with *Pause fulfillment* (marketplace staff) — paid orders are held, not lost.

Required environment: `NEXT_PUBLIC_APP_URL` must be the public HTTPS origin (supplier file access), `INTEGRATION_ENCRYPTION_KEY` (vault and file-URL signing), existing Stripe and Resend configuration, and `MASTER_ADMIN_EMAIL` for admin alerts.

## Tests

- `tests/gelato.test.mjs` (unit, in `npm test`): endpoints, error classification, decimal money, parsing, status mapping, payloads, quotes, pricing guards (sweep), design validation, real PDF rendering, SVG safety, artwork normalization, signed URLs.
- `tests/gelato.integration.mjs` (real Postgres, scripted Gelato API, stubbed Stripe session creation with real webhook signatures): 18 end-to-end scenarios from connection through fulfillment, tracking, refunds, guests and isolation.
- `tests/gelato.browser.mjs` (local production server, Chromium): admin console, publish + audit, storefront, product page, Brand Studio upload → approve → PDF proof, cart, guest storefront and order lookup, access control, 390px layouts.

## Known limitations

- Subscriber discounts and promotion codes are not applied to marketplace checkout yet.
- Studio supports PNG/JPG/WebP/SVG; PDF artwork upload is not supported.
- Previews are approximate color mockups; product photography is uploaded by admins.
- Shipping is to the United States only (existing marketplace scope).
