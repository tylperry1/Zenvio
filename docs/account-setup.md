# Activate accounts and the master admin

The application code is ready for Supabase. Production accounts remain closed until the dedicated backend is configured. No owner account or password is embedded in the source.

## 1. Create the backend

Create a new project named **Zenvio** at https://supabase.com/dashboard. Choose a strong database password and retain it in your password manager. Use a US region near Vercel's `iad1` region. Keep this project separate from other businesses.

In the project's SQL editor, run these files in order:

1. `supabase/migrations/001_initial.sql`
2. `supabase/migrations/002_brand_defaults.sql`
3. `supabase/migrations/003_platform_admin.sql`

Run each once. The first migration creates the account/profile provisioning trigger, so apply it before registering users. The admin migration adds protected platform roles, a paginated account directory, per-account booking-link controls, and an admin audit log. Existing users cannot promote themselves through profile updates or signup metadata.

## 2. Configure authentication and email

In Authentication URL Configuration:

- Site URL: `https://zenvio-two.vercel.app`
- Redirect allowlist: `https://zenvio-two.vercel.app/reset-password`

Enable email/password registration and email confirmation. Configure production SMTP with a verified sender domain; Supabase's default email service has restricted delivery. Set appropriate provider auth rate limits. Do not turn off email confirmation for the owner account.

## 3. Connect the existing Vercel project

In Vercel → **zenvio** → Settings → Environment Variables, add:

- `SUPABASE_URL`: the Supabase project URL.
- `SUPABASE_ANON_KEY`: the public anon/publishable key, not the secret or service-role key.
- `NEXT_PUBLIC_APP_URL`: `https://zenvio-two.vercel.app`.

Set these for **Production**. Keep preview database credentials separate. Save them directly in Vercel; do not put passwords or privileged service keys in chat, GitHub, or public source. A service-role key is not required by this implementation.

Redeploy the current production commit after the variables are saved. `/api/config` checks public schema connectivity before enabling the account forms. The health endpoint reports environment configuration separately.

For additional checks, run `node --env-file=.env.local scripts/check-accounts.mjs` locally with Node 22+. It checks public schema availability and anonymous access denial without printing secrets. Never point the app at an unrelated project's database.

## 4. Create and assign the verified owner

1. Register the chosen owner email on `/sign-up` with a strong, unique password.
2. Open the verification email and confirm the account.
3. In the Supabase SQL editor, open `supabase/admin/assign_master_admin.sql`, replace its placeholder with the confirmed owner email, and run it. This privileged database operation is the only initial promotion path. The script refuses unverified users and refuses to silently add a second owner.
4. Sign in again. Verified master admins go to `/admin`; members go to `/app`. Master admins can also open their personal workspace, which links back to administration.

The bootstrap checks the verified `auth.users` record, not a claimed profile email. Account owners have no grants to read or edit the private role table. Admin API requests revalidate both the Supabase session and the current database role. Admin RPCs repeat the permission check in the database. Pausing or resuming a booking link requires an audit reason and does not cancel existing appointments.

## 5. Acceptance checks

- Register and confirm a separate member account. Check that it goes to `/app` and receives HTTP 403 from `/api/admin`.
- Confirm that anonymous requests receive HTTP 401 from `/api/admin`.
- Confirm master-admin sign-in opens `/admin`, account search and pagination work, and a paused/resumed booking link creates an audit entry.
- Verify a member cannot edit another member's event types or availability, and cannot grant roles through profile or auth metadata.
- Reserve a public appointment from a separate browser. Verify it appears only in the appropriate workspace and that two simultaneous attempts at the same slot cannot both succeed.
- Test email confirmation, password recovery, sign-out, session refresh, and cancellation.

The master-admin area currently supports overview, account inspection, booking-link controls, and its own audit history. It does not implement impersonation, password viewing, account deletion, billing, or team permission management.
