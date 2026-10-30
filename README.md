# Zenvio

A scheduling MVP with a public marketing site, booking pages, owner workspace, event types, weekly availability, bookings, and contacts. Next.js App Router, React, TypeScript, and Better Auth and Neon Postgres. Designed for Vercel.

## Run

Use Node 22 or 24. Run `npm install`, copy `.env.example` to `.env.local`, then `npm run dev`.

`npm run typecheck`, `npm test`, and `npm run build` validate the application. `/api/health` reports application availability and whether account configuration is present; it does not claim database connectivity.

## Enable real accounts and bookings

Use a dedicated Neon Postgres database and Better Auth. Follow [the account setup guide](docs/account-setup.md) for environment variables, migrations, owner invitation and email configuration. Supabase is no longer required. Production builds apply pending Postgres migrations; preview accounts remain disabled while previews share the production connection.

## Included

- Public host profiles at `/book/[host]`, with a customizable headline, business name, bio and accent color; guests choose an active appointment type before selecting a time.
- Appointment-type deletion with confirmation and success notifications. Deleted types stop accepting bookings, while existing appointments and their cancellation links remain intact.

- Responsive marketing site, feature details, current free plan, explicit planned upgrades, privacy, terms, and error pages.
- Real email/password auth endpoints with server-only HttpOnly cookies, verified server identity, refresh, recovery, sign-out, and password update.
- Owner-only event type management, duration, custom meeting location, color, activation, and post-meeting buffer.
- Weekly hours and IANA timezones, 2-hour minimum notice, 90-day booking horizon, 15-minute slot increments.
- Public booking, notes, contact creation, confirmation, private cancellation link, and `.ics` downloads.
- Appointment list/calendar, owner cancellation, contact search and CSV export, and profile settings.
- Row-level ownership, server input validation, origin checks for mutations, body size limits, security headers, and an exclusion constraint to prevent concurrent double bookings.

## Current limits

Private calendar subscription feeds provide one-way sync of confirmed and cancelled bookings. Two-way calendar conflict checking, automatic meeting links, reminder emails, paid appointment checkout, teams, round robin, custom domains per host, rescheduling, and full contact editing remain unimplemented. Booking confirmation/cancellation email is queued transactionally and delivered through Resend when configured. Pending messages retry on booking/workspace activity or the admin process button, with a five-attempt limit and five-minute backoff. Zenvio only detects conflicts with other Zenvio bookings. Public availability reveals occupied versus available time but never guest details.

The current guest booking abuse control limits five attempts per email/host/hour. It does not prevent distributed abuse with different email addresses. Add a server-verified CAPTCHA and IP-level shared rate limiting before promoting widely. Authentication rate limits are stored in Postgres by Better Auth. Dashboard lists currently cap at 1,000 appointments and contacts; add pagination before larger accounts. Deletion/export self-service for accounts is not implemented.

## Deployment

Connect `tylperry1/Zenvio` to the existing Vercel project `zenvio`, production branch `main`, framework Next.js, root directory unset, Node 24, default install/build settings. Set account variables before enabling real account usage. Production and preview database environments should be isolated.

Production build, type checking, and scheduling unit tests can be run without database credentials. A passing build does **not** verify real authentication, the SQL migration, database concurrency, or email delivery; the live acceptance test above is required after configuration.

## Platform operations

Master admin → Platform controls manages encrypted provider credentials, site-wide USD plan prices, user session revocation, subscription cancellation/resumption, email delivery counts, and configuration history. Credential values are never returned by the API. `INTEGRATION_ENCRYPTION_KEY` must be a stable random server secret; losing it makes stored provider credentials unreadable. Database and authentication secrets are intentionally excluded from editable integration settings.

Workspace settings link to billing, calendar connections, and the branding marketplace. Photos are limited to 2 MB input, decoded/re-encoded to 512px WebP with metadata removed, and stored in the dedicated Postgres database.

Resend: enter `RESEND_API_KEY` and a verified `AUTH_EMAIL_FROM` in Platform controls; send a test email there. Password recovery and queued booking notifications use those settings immediately. Signup verification behavior remains controlled by the deployment's original email environment configuration; setting a runtime key does not silently lock existing users out.

Stripe subscriptions: current packages are **Individual $29.99/month** and **Teams $49.99/month including 3 seats, plus $9.99 for each additional seat**. Both include scheduling and signing; new packages are monthly only. See [subscription packages and manager permissions](docs/SUBSCRIPTION_PACKAGES.md) for limits and acceptance tests. Production builds provision immutable price mappings using the existing Stripe key and webhook secret. Checkout remains unavailable until both credentials and all mappings are ready; `BILLING_CHECKOUT_ENABLED=false` explicitly holds enrollment. Configure `/api/billing/webhook` for `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`. Signed webhooks, account ownership checks, item-based seat reconciliation, billing portal, cancellation/resumption, and proration confirmation are implemented. Existing legacy subscriptions retain their original prices unless the customer explicitly switches. No live customer charge was created during development.

Marketplace: the catalog, product images, suppliers, stock, cart, orders, fulfillment history, tracking, and refunds are internal to Zenvio. Master admin manages these under Marketplace & suppliers. Stripe is used only for payment processing; no external store platform is required. Configure the Stripe secret and `STRIPE_MARKETPLACE_WEBHOOK_SECRET`, Stripe Tax, and US shipping operations before enabling checkout in marketplace Settings. Use `/api/marketplace/webhook` with checkout completion/expiration and `charge.refunded` events. Catalog browsing works before payments are enabled.

Calendar: users can create, rotate, or revoke a private subscription URL compatible with Google Calendar, Outlook, and Apple Calendar. Feeds contain appointment titles/times/locations, never guest emails or notes. Treat the URL as a secret. Provider refresh times vary. Direct Google OAuth is available separately: it checks primary-calendar busy times and exports Zenvio bookings/cancellations. Microsoft OAuth remains unimplemented.

### Subscription management and booking detail updates

Platform controls now has focused Subscriptions, Users & activity, Integrations, Pricing, and Health sections. Master admin can search/filter/paginate all accounts (including Free), inspect renewal status, view account invoices, and schedule cancellation or resume renewal with an audited reason. Members have a dedicated plan/billing page with status, period end, confirmation dialogs, invoice history, and the Stripe billing portal. Subscription changes validate both Stripe customer ownership and subscription metadata, reject terminal statuses, serialize with webhooks, and immediately reconcile the local record. New paid enrollment remains disabled while paid entitlements are unfinished.

Booking forms now accept optional phone, company, and meeting purpose alongside preparation notes. The reservation wrapper saves these fields in the same transaction as the booking, preserving existing concurrency guarantees. Responses are private to the host workspace; company fills an empty matching contact company. Guests see start/end times and timezone, a two-step indicator, and retain entered details when returning to time selection. Existing booking clients remain compatible because the added fields default to empty strings.


### Internal marketplace operations

Products use native UUIDs and SKUs, USD prices, private supplier costs, minimum quantities, per-unit shipping fees, and optional finite inventory. Checkout validates current database prices and availability, locks product rows, snapshots order items, and reserves finite stock in one transaction. Payment confirmation is accepted only through a signed Stripe webhook or authenticated server-side Stripe reconciliation. Checkout expiration releases reservations once; order records and product snapshots are preserved. Pending checkouts can be expired from admin. Refund requests require a reason and use an idempotency key; refunded products are not automatically restocked or cancelled with suppliers.

Supplier integrations are manual in this release: admin records partners and terms, coordinates production, and updates processing/shipped/delivered state and tracking. No supplier contract, catalog, inventory feed, or purchase order is fabricated. Product photos are uploaded directly to Zenvio and re-encoded as WebP. Shoppers cannot access supplier costs, private notes, or another account's orders. Checkout is disabled by default; payment keys alone do not activate it.


### Google Calendar direct sync

Enable Calendar API in your Google Cloud project, configure the Zenvio OAuth consent screen, create a Web application OAuth client, and register `https://gozenvio.com/api/calendars/google/callback`. Save the client ID/secret in Master admin → Integrations, then connect each user from Dashboard → Settings → Calendar connections. Google Testing mode requires test users and can limit refresh-token lifetime; public use may require Google verification. Use the callback URL displayed in the app for other environments.

Authorization uses the official Google auth library, PKCE, a single-use state hash bound to the signed-in user, verified Google identity tokens, and encrypted access/refresh tokens. Up to five Google accounts per host are supported, each using its primary calendar. Conflict checks combine every enabled account; appointment copies are independently enabled per account. Reconnecting the same Google identity updates its credentials without replacing other accounts. Secondary/shared calendars within an account and other direct providers are not implemented. Busy-time checks run when slots are viewed and immediately before confirmation, including meeting buffers; connected checks fail closed if Google access is unavailable. Calendar changes concurrent with a booking cannot be atomically reserved across both providers.

Bookings and cancellations enter a native queue. Delivery uses stable Google event IDs, ownership metadata, per-booking leases, revision checks, bounded retries, and an authenticated daily retry task. Existing upcoming bookings queue on connection. Sync now processes up to 20 pending updates and reports remaining work. Zenvio writes guest name/email but does not export private notes, cancellation tokens, or other appointments' details. Google edits/deletes do not change Zenvio bookings. Disconnect revokes access where possible and deletes local credentials; existing Google events are kept.

`CRON_SECRET` authenticates `/api/calendars/google/retry`. Vercel runs the retry task daily; app activity and manual sync also process queued work. The Google client credentials and encryption secret stay server-side. Neither the auth code nor OAuth tokens are returned to the browser after callback.

### Native document signing (initial release)

Workspace → Documents & signatures supports text agreements up to 9,000 characters, optional reusable templates, one named recipient, and an optional appointment association. Creating a document locks its content and returns a private 256-bit signing link once. Only its SHA-256 token hash is stored; the browser fragment is removed when the signer opens the page. Invitations are shared manually; no signing emails are sent automatically. Unsigned links expire after 14 days and can be voided by their owner. Signed links remain available to their holders for copies.

Signing requires explicit consent and a typed name. An atomic row lock prevents duplicate signatures and signing after voiding. The record includes timestamps, document content hash, and a receipt hash binding the document, recipient, typed name, timestamp, and consent statement. This is link possession and self-attestation, not independent email/identity verification or a cryptographic identity certificate. Signed content is not editable through the application. Users with signing records cannot be hard deleted through admin account management. Text downloads include agreement content and the signing record; signers can use Print / save PDF for a printable PDF. Uploaded PDFs, draggable signature fields, multiple signers, email invitations/reminders, and OTP verification are not included in this initial release.

`tests/documents.integration.mjs` checks ownership, token hashing, consent, content hash matching, concurrent signing, signed-record immutability, download contents, expiry, and voiding against an isolated local Postgres database. Never run integration tests against production.
