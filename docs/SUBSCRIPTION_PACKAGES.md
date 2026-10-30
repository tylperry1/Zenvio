# Monthly subscription packages

Approved packages (USD, before tax):

| Package | Monthly recurring charge | Paid hosts |
| --- | --- | --- |
| Individual | $29.99 | 1 |
| Teams | $49.99 base + $9.99 for each seat above 3 | 3–1,000 |

Examples: 3 seats $49.99; 4 $59.98; 5 $69.97; 10 $119.92. The owner counts as a seat. Clients and signing recipients never need paid seats. New packages are monthly only. Existing legacy subscriptions and their annual/monthly prices are unchanged unless the customer explicitly switches.

Both paid packages: unlimited bookings; 100 active personal event types and 5 connected Google accounts per host; 25 enabled workflows per workspace; client records; appointment payments; PDF templates and signing. Each host has 100 document envelopes per calendar month. Created drafts count; multiple recipients in one envelope do not count separately. Teams also has a shared 100 × seats envelope budget. Allowances do not roll over; no automatic overage charges. Existing records remain available when capacity is reached.

## Billing implementation

Three new immutable monthly prices: `individual` (2999 cents, quantity 1), `team` (4999 cents, quantity 1), `team_extra` (999 cents, quantity seats − 3, omitted at 3 seats). Never multiply the Teams base by the full seat count.

`033_simple_subscription_packages.sql` extends constraints and entitlement functions; it does not change old migrations or reprice any existing subscription. `scripts/provision-subscription-packages.mjs` runs only during production builds, uses the existing Stripe connection, verifies/creates versioned products and recurring prices, and saves their mappings. It neither charges a customer nor edits old prices/subscriptions. If billing credentials or the webhook secret are missing it reports that setup is pending.

Enrollment requires Stripe credentials, a webhook secret, all three mappings, and no explicit `BILLING_CHECKOUT_ENABLED=false` hold. The UI consumes the actual readiness state. Checkout verifies amount, currency, interval and active price status server-side. New checkout expires abandoned sessions and checks for existing subscriptions first. Only the authenticated account may change its own subscription. Package changes require explicit confirmation; immediate prorations use `always_invoice` with `pending_if_incomplete`. Entitlements follow confirmed Stripe items, never the requested package. Webhooks derive seats from mapped line items regardless of their order. Existing cancellation/resumption, receipts, portal access and audited admin controls remain.

## Team managers

The stored `administrator` role is labeled **Manager**. Managers may invite staff via private invitation links, deactivate/reactivate staff within already-paid capacity, revoke staff invitations, rename the workspace, and manage shared scheduling. They cannot manage peer managers, demote/remove the owner, edit their own membership, change global account credentials, or change anyone’s subscription. Owners alone assign manager roles and manage billing/seats. Inactive members retain their own accounts and records. Upcoming appointments must be reassigned or canceled before deactivation. Reactivation does not restore prior scheduling assignments automatically. Role and membership changes are audited.

## Verification

Run `npm test`, source type checking, and a production build. Added regression coverage tests approved totals, base/extra-seat item quantities, Stripe item order, forged metadata, invalid quantities, unpaid states and manager privilege boundaries. Test authenticated billing/Teams pages against a fixture account before enrolling a real customer. No live customer charge is needed to verify a deployment.
