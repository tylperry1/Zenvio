# Zenvio roadmap and completion synopsis

Updated October 27, 2026. This document distinguishes implemented product behavior from configuration, verification, and planned work.

## Implemented

| Area | Completed behavior |
| --- | --- |
| Brand and landing page | Approved Clear & Connected Zenvio identity, cobalt/midnight palette, SVG logos, responsive landing page, interactive preview, pricing, FAQs, and booking examples. |
| Accounts and database | Dedicated Neon Postgres, Better Auth signup/sign-in/sign-out, password reset email integration, secure sessions, private owner setup, server-checked master admin access, and isolated user data. Production uses gozenvio.com consistently for navigation, authentication, and callbacks. |
| Scheduling | Appointment types with durations, buffers, meeting locations, weekly availability, timezones/DST handling, public booking pages, transactional conflict protection, cancellation links, and calendar downloads. Types can be safely deleted without erasing appointment history. |
| Booking profiles | Profile photo upload and removal, short bio, headline, business name, accent color, public host profile with appointment type selection, preview, and copy-link actions. Images are validated and re-encoded. |
| Detailed booking forms | Guest name/email plus optional phone, company, meeting purpose, and notes; timezone-aware time selection and retained form entries. |
| Manual appointments | Bookings → Create appointment. Select an active type, an available date/time, an existing contact or new client, and optional meeting details. Uses the same two-hour minimum notice, 90-day window, availability, buffers, conflict protection, email queue, and calendar jobs as public bookings. Arbitrary-time overrides and custom-duration appointments are not included. |
| Contacts | Contact search, details, notes, appointment history, and CSV export. Manual appointments can prefill a selected contact's name and email. |
| Master admin | Platform overview, accounts and details, activity/audit, booking-link pause/resume, exports, user management, subscription controls, integration credentials, pricing, actual database health and email queue status. Persistent return-to-admin access from the user dashboard. |
| Admin user editing | Edit member name, email, and timezone with a reason. Email changes clear verification and revoke sessions; verification delivery is attempted when account mail is configured. Master admin accounts and self-editing through admin controls are protected. |
| Admin deletion | Typed-email confirmation and reason. Eligible accounts can be permanently deleted. Deletion is blocked for upcoming confirmed appointments, pending calendar jobs, and retained billing, marketplace order, or document-signing records. This is deliberately not a blanket purge of financial or agreement history. |
| Professional UI | Shared admin sidebar, focused operations pages, comparable pricing cards, clear rate inputs, annual savings, grouped settings links, padded calendar connection card, compact photo control, responsive profile form, and improved shared cards and forms. |
| Email integration | Resend credential/sender setup, password reset and account email support, transactional booking confirmation/cancellation outbox, retries, delivery status, and admin test/retry controls. Credentials/sender domain configuration are still required for delivery. |
| Subscription management | User plan/billing page, customer-scoped invoices, Stripe portal, cancellation/resume, master-admin subscription search/filter/details, reasoned/audited changes, signed webhooks and local reconciliation. Paid self-service enrollment remains gated pending complete entitlements and final plan setup. |
| Pricing | Approved defaults: Free $0; Pro $5/month or $48/year; Business $12/month or $120/year; Teams $9/host/month or $84/host/year, three-host minimum. Admin can change displayed/new-checkout rates; existing Stripe subscriptions retain their prices. |
| Google calendars | OAuth/PKCE and encrypted tokens, up to five connected Google accounts per host, each account's primary calendar, independent conflict-check and appointment-copy preferences, combined busy-time filtering, separate event mappings per account, account-specific disconnect, retries, and daily retry task. Reconnecting one identity preserves the other accounts. |
| Other calendar clients | Private one-way subscription feeds for Google Calendar, Outlook, and Apple Calendar, with rotation/revocation. Feeds do not check external conflicts. |
| Internal marketplace | Native Postgres catalog, categories, search, cart, server-authoritative pricing, inventory reservation, Stripe card checkout preparation, own order history, admin catalog/photos/suppliers, payment webhooks, order fulfillment statuses, tracking, cancellation/expiration handling, refund controls and records. No Shopify or external store platform. |
| Demo marketplace | Eight clearly labeled sample products in six categories: Business cards, Print marketing, Signs & banners, Branded apparel, Promotional gifts, and Branding kits. Illustrative mockups/sample prices, no claimed supplier inventory, and server-enforced purchase blocking. Admin can edit or archive sample listings; samples remain non-purchasable. |
| Supplier management | Internal wholesale/dropship/print-on-demand supplier records, contact details, fulfillment terms, lead times, costs, supplier SKUs, and private notes. Orders are coordinated manually; automatic supplier API ordering/catalog synchronization is not implemented. |
| Native document signing, phase 1 | Documents & signatures navigation, text agreements up to 9,000 characters, reusable text templates, optional appointment link, one recipient, private signing links, review screen, typed name and explicit consent, document/receipt hashes, timestamps, view/sign/void activity, expiry for unsigned links, signed text downloads, and signer Print / save PDF. Signed text is not editable through the app. |

## Activation and scope limits

- **Google production verification:** branding/domain verification was completed by the owner; sensitive calendar permission review still needs its scope justifications/demo video and Google's approval. Publishing status is separate from approval. No real Google account or provider approval is fabricated by tests.
- **Google scope:** primary calendars from multiple accounts are supported. Secondary/shared calendar selection within an account, Outlook OAuth, and Google-originated appointment rescheduling/cancellation remain outstanding. Google changes are not atomically reserved with Postgres; simultaneous external changes can require review. Disabling copies/disconnecting keeps existing Google events.
- **Document signing:** native text agreements only. Uploaded PDF field placement, multiple signers, automatic email invitations/reminders, OTP/email ownership checks, and independent identity verification are outstanding. Private-link possession and a typed name are self-attestation; a receipt hash is not a cryptographic identity certificate. Signing links are shared manually and displayed once to the sender. Signed records are retained.
- **Marketplace commerce:** demo products cannot be purchased. Real products, negotiated suppliers, shipping/tax setup, Stripe keys, the marketplace webhook secret, and an explicit checkout enablement are needed before live sales. No live purchase, refund, supplier contract, or fulfillment arrangement is implied by the demo catalog.
- **Subscription launch:** existing subscription management is ready for configured Stripe customers, but paid enrollment is disabled until the approved plan entitlements, feature gates, and billing configuration are fully implemented. Business and Teams checkout are not fully enabled.
- **Email:** Resend code is integrated; successful live delivery depends on a valid key, verified sender/domain, and deployment configuration. Retries can be inspected in admin.

## Next priorities

1. Finish Google sensitive-scope verification and validate with real connected accounts.
2. Add selection of secondary/shared calendars inside Google accounts, then Outlook OAuth.
3. Expand document signing to uploaded PDFs, placed fields, signer verification, multiple recipients, delivery and reminders.
4. Finish plan entitlements and annual/seat billing, then enable paid enrollment deliberately.
5. Add real marketplace products and supplier agreements; integrate supplier catalog, inventory, order placement, and return workflows.
6. Add appointment reminders, custom booking questions, rescheduling, team scheduling and round-robin availability.
7. Add signed-document retention/export administration and account deactivation/anonymization workflows for users with retained history.

## Validation

Unit checks cover authorization, origin enforcement, scheduling conflicts, native checkout validation, vault encryption, subscription ownership, user editing/deletion protections, manual appointment ownership, and signing hashes. Isolated Postgres integration exercises accounts, actual manual reservations and concurrency, admin edits/deletion, signature immutability/expiry/voiding and concurrent signing, and native marketplace inventory/payment reconciliation. Google tests use a real isolated database with substituted Google network responses. Browser checks cover desktop/mobile layouts and the agreement creation/signing flow. Test accounts, documents, purchases, and signatures belong only to isolated test environments.
