# Zenvio

A scheduling MVP with a public marketing site, booking pages, owner workspace, event types, weekly availability, bookings, and contacts. Next.js App Router, React, TypeScript, and Better Auth and Neon Postgres. Designed for Vercel.

## Run

Use Node 22 or 24. Run `npm install`, copy `.env.example` to `.env.local`, then `npm run dev`.

`npm run typecheck`, `npm test`, and `npm run build` validate the application. `/api/health` reports application availability and whether account configuration is present; it does not claim database connectivity.

## Enable real accounts and bookings

Use a dedicated Neon Postgres database and Better Auth. Follow [the account setup guide](docs/account-setup.md) for environment variables, migrations, owner invitation and email configuration. Supabase is no longer required. Production builds apply pending Postgres migrations; preview accounts remain disabled while previews share the production connection.

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

The current guest booking abuse control limits five attempts per email/host/hour. It does not prevent distributed abuse with different email addresses. Add a server-verified CAPTCHA and IP-level shared rate limiting before promoting widely. Authentication rate limits are stored in Postgres by Better Auth. Dashboard lists currently cap at 1,000 appointments and contacts; add pagination before larger accounts. Deletion/export self-service for accounts is not implemented.

## Deployment

Connect `tylperry1/Zenvio` to the existing Vercel project `zenvio`, production branch `main`, framework Next.js, root directory unset, Node 24, default install/build settings. Set account variables before enabling real account usage. Production and preview database environments should be isolated.

Production build, type checking, and scheduling unit tests can be run without database credentials. A passing build does **not** verify real authentication, the SQL migration, database concurrency, or email delivery; the live acceptance test above is required after configuration.
