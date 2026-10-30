# Monthly subscription packages

Approved packages (USD, before tax):

| Package | Monthly recurring charge | Paid hosts |
| --- | --- | --- |
| Individual | $29.99 | 1 |
| Teams | $49.99 base + $9.99 for each seat above 3 | 3–1,000 |

Examples: 3 seats $49.99; 4 $59.98; 5 $69.97; 10 $119.92. Every active team member counts as a seat, including managers and the owner. Clients and signing recipients never need paid seats. New packages are monthly only. Existing legacy subscriptions and their annual/monthly prices are unchanged unless the customer explicitly switches.

Both paid packages: unlimited bookings; 100 active personal event types and 5 connected Google accounts per host; 25 enabled workflows per workspace; client records; appointment payments; PDF templates and signing. New Individual subscriptions include 20 sent envelopes per UTC calendar month. Teams pools 20 per licensed seat (60 at three seats); a single host may use the full shared pool. Draft uploads and template instantiations are free, as are reminders/resends. Text document creation immediately issues a signing link and counts as a send. Multiple signers count as one envelope. Voiding/declining a sent envelope does not reverse usage. Allowances reset at 00:00 UTC on the first and never roll over.

Overages default off. Only the billing owner may explicitly authorize $1 per additional envelope and set a $1–$1,000 monthly spending limit (before tax). The UI warns at 80% and 100%. Server-side shared locks enforce the allowance and cap across simultaneous sends; membership changes never reassign already-recorded sends. Lowering a cap or disabling overages does not erase accrued charges. Managers/staff cannot enable spending. An active subscription and complete Stripe billing configuration are required for overages; trials cannot incur overages.

Migration 034 preserves 100 envelopes per seat for existing Individual/Teams subscriptions; new subscriptions and explicit package changes get 20. Older Pro/Business/Teams retain their allowances. Historical sends are backfilled for the current month at zero charge, excluding drafts. Existing documents remain accessible.

Approved additional usage is billed on a separate USD invoice after calendar month-end, including when the subscription has since been canceled. The existing authenticated daily cron settles closed months, with a durable invoice ID saved before finalization, reconciliation on retry, and one aggregate line per customer/month. Stripe collects using the billing account's payment method. Draft invoices created during a database failure cannot auto-finalize. Failed settlement retries the next daily run. Invoice history includes these invoices. No live customer payment is used for testing.

## Billing implementation

Three new immutable monthly prices: `individual` (2999 cents, quantity 1), `team` (4999 cents, quantity 1), `team_extra` (999 cents, quantity seats − 3, omitted at 3 seats). Never multiply the Teams base by the full seat count.

`033_simple_subscription_packages.sql` extends constraints and entitlement functions; it does not change old migrations or reprice any existing subscription. `scripts/provision-subscription-packages.mjs` runs only during production builds, uses the existing Stripe connection, verifies/creates versioned products and recurring prices, and saves their mappings. It neither charges a customer nor edits old prices/subscriptions. If billing credentials or the webhook secret are missing it reports that setup is pending.

Enrollment requires Stripe credentials, a webhook secret, all three mappings, and explicit `BILLING_CHECKOUT_ENABLED=true` launch approval. The UI consumes the actual readiness state. Checkout verifies amount, currency, interval and active price status server-side. New checkout expires abandoned sessions and checks for existing subscriptions first. Only the authenticated account may change its own subscription. Package changes require explicit confirmation; immediate prorations use `always_invoice` with `pending_if_incomplete`. Entitlements follow confirmed Stripe items, never the requested package. Webhooks derive seats from mapped line items regardless of their order. Existing cancellation/resumption, receipts, portal access and audited admin controls remain.

## Team managers

The stored `administrator` role is labeled **Manager**. Managers may invite staff via private invitation links, deactivate/reactivate staff within already-paid capacity, revoke staff invitations, rename the workspace, and manage shared scheduling. They cannot manage peer managers, demote/remove the owner, edit their own membership, change global account credentials, or change anyone’s subscription. Owners alone assign manager roles and manage billing/seats. Inactive members retain their own accounts and records. Upcoming appointments must be reassigned or canceled before deactivation. Reactivation does not restore prior scheduling assignments automatically. Role and membership changes are audited.

## Verification

Run `npm test`, source type checking, and a production build. Added regression coverage tests approved totals, base/extra-seat item quantities, Stripe item order, forged metadata, invalid quantities, unpaid states and manager privilege boundaries. Test authenticated billing/Teams pages against a fixture account before enrolling a real customer. No live customer charge is needed to verify a deployment.


## Prelaunch early access

Public CTAs go to `/early-access`; `/sign-up` redirects there until `BILLING_CHECKOUT_ENABLED=true`. Existing sign-in and workspace access remain available. The form stores name, normalized unique email, plan interest, expected seats, consent timestamp, and the versioned offer. Repeated submissions do not overwrite existing entries. A honeypot and database-backed email/IP throttling reduce spam. No account, payment, or email is sent by joining. Master admins review the list at `/admin/early-access`.

Offer: 50% off the first three monthly subscription payments for a new paid billing account, reserved by signup email before launch. Individual rounds to $15/month, then $29.99. Teams base rounds to $25/month, then $49.99; additional-seat subscription charges are also discounted. $1 envelope overages, taxes, and processing fees are excluded. No promised launch date. Provisioning creates a product-restricted, versioned Stripe coupon; checkout verifies it and binds the reservation to one account. Existing subscribers and subscription changes never receive the new-customer coupon. At launch, use the same email as the reservation. Launch communication is a separate authorized operation; do not automatically email the list.
