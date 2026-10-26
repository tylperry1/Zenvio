# Zenvio

A scheduling MVP with a public marketing site, booking pages, owner workspace, event types, weekly availability, bookings, and contacts. Next.js App Router, React, TypeScript, and Supabase Auth/Postgres. Designed for Vercel.

## Run

Use Node 22 or 24. Run `npm install`, copy `.env.example` to `.env.local`, then `npm run dev`.

`npm run typecheck`, `npm test`, and `npm run build` validate the application. `/api/health` reports application availability and whether account configuration is present; it does not claim database connectivity.

## Enable real accounts and bookings

For the full setup and verified master-admin assignment, follow [the account setup guide](docs/account-setup.md).

1. Create a **dedicated** Supabase project. Do not reuse an unrelated application's database.
2. Run the SQL files in `supabase/migrations/` in numeric order in its SQL editor. The initial migration creates tables, RLS policies, user provisioning, conflict prevention, and narrow public booking functions. The second migration sets the approved cobalt default for new event types without updating existing records. The third creates protected master-admin roles and audited booking-link controls. Existing auth users are not automatically backfilled; run these migrations before registration.
3. Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` to the Vercel project's production environment. These are the project URL and public anon/publishable key, **not** a service-role key. No service-role key is needed.
4. Set the Supabase Auth site URL to the actual production origin, and allow `<origin>/reset-password` in redirect URLs. Email confirmation should be enabled. Configure production SMTP and appropriate auth rate limits/CAPTCHA before broad promotion. Default Supabase email delivery is restricted and is not a production email service.
5. Redeploy. Create and confirm a test account, sign in, set a personal booking slug and timezone, create an event, and set weekly hours. Use another browser to reserve an appointment and verify it appears in the owner's workspace. Check two concurrent attempts at the same slot: only one should succeed. Test cancellation and password reset.

Without configuration, real account and booking endpoints fail closed with a clear service-unavailable response. No real account is simulated. `/demo` is a separate browser-only sandbox with clearly marked sample data; `/book/demo/...` only changes that sandbox and cannot receive bookings from another device. The `demo` host address is reserved.

## Included

- Responsive marketing site, feature details, current free plan, explicit planned upgrades, privacy, terms, and error pages.
- Real email/password auth endpoints with server-only HttpOnly cookies, verified server identity, refresh, recovery, sign-out, and password update.
- Owner-only event type management, duration, custom meeting location, color, activation, and post-meeting buffer.
- Weekly hours and IANA timezones, 2-hour minimum notice, 90-day booking horizon, 15-minute slot increments.
- Public booking, notes, contact creation, confirmation, private cancellation link, and `.ics` downloads.
- Appointment list/calendar, owner cancellation, contact search and CSV export, and profile settings.
- Row-level ownership, server input validation, origin checks for mutations, body size limits, security headers, and an exclusion constraint to prevent concurrent double bookings.

## Current limits

Calendar sync, automatic meeting links, confirmation/reminder email, payments, subscriptions, teams, round robin, custom domains per host, booking reschedule, and full contact editing are **not implemented**. Owner cancellation does not email the guest; the UI says so. Zenvio only detects conflicts with other Zenvio bookings. Calendar invites are downloads. Public availability reveals occupied versus available time but never guest details.

The current guest booking abuse control limits five attempts per email/host/hour. It does not prevent distributed abuse with different email addresses. Add a server-verified CAPTCHA and IP-level shared rate limiting before promoting widely. Authentication rate limits are provided by Supabase. Dashboard lists currently cap at 1,000 appointments and contacts; add pagination before larger accounts. Deletion/export self-service for accounts is not implemented.

## Deployment

Connect `tylperry1/Zenvio` to the existing Vercel project `zenvio`, production branch `main`, framework Next.js, root directory unset, Node 24, default install/build settings. Set account variables before enabling real account usage. Production and preview database environments should be isolated.

Production build, type checking, and scheduling unit tests can be run without Supabase credentials. A passing build does **not** verify real authentication, the SQL migration, database concurrency, or email delivery; the live acceptance test above is required after configuration.
