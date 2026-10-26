# Zenvio accounts on dedicated Neon Postgres

Production uses `DATABASE_URL`, a random `BETTER_AUTH_SECRET` (32+ bytes), `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` set to the production origin. Supabase is no longer used. Better Auth stores password hashes, sessions and recovery tokens in this database. Passwords are never logged or committed.

`npm run db:migrate` applies checksummed SQL migrations under an advisory lock. The production build applies pending migrations before compiling; it fails if migration fails. Builds without database configuration skip migration and account endpoints fail closed. Preview deployments sharing production's connection deliberately disable accounts and skip migrations; give previews an isolated database before enabling them. Never test mutations against production accounts.

Application data is accessed with a transaction-local restricted Postgres role and verified user ID. RLS policies and column grants enforce ownership. Narrow SQL functions provide public booking, cancellation, and admin actions. The booking exclusion constraint and advisory lock prevent concurrent reservations. Admin roles are stored separately from editable profiles and checked on each request.

## Owner invitation

Set `MASTER_ADMIN_EMAIL` to the selected owner email, and `MASTER_ADMIN_SETUP_TOKEN` to a cryptographically random 32-byte or longer invitation secret. Open `/admin/setup#token=SECRET` privately. The owner chooses their name and password. The reserved email cannot register through regular signup. Possession of the invitation provisions and verifies the selected identity, assigns the database role, records an audit entry and consumes the invitation transactionally. Sign in afterward. A used invitation cannot grant access again, even if the admin role is later revoked. Remove `MASTER_ADMIN_SETUP_TOKEN` after setup. Do not share or commit this URL.

## Email

Set `RESEND_API_KEY` and `AUTH_EMAIL_FROM` to a verified sender to enable signup verification and password recovery. Without these, ordinary users may sign up/sign in with unverified emails, and reset requests explicitly report email delivery unavailable. The owner invitation provides a separate controlled identity-provisioning path. Do not claim automatic emails until sender configuration and delivery have been tested.

## Verification

Run type checking, unit tests and a production build. With an isolated Postgres database, verify signup, sign-in/out, cross-account denial, master-admin denial for regular members, role revocation, owner invitation single use, booking, concurrent conflicts and cancellation. Check recovery end to end once an email sender is connected.

Historical Supabase SQL is retained under `supabase/` for reference only. Apply only `postgres/migrations/` to the dedicated new database. Existing Supabase deployments would require a separate data migration; this project had no connected Supabase accounts.
