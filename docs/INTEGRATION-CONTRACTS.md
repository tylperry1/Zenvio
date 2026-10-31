# Zenvio integration contracts

The canonical TypeScript contracts for messaging, consent, provider health, and AI-safe read/action flows live in `src/lib/integration-contracts.ts`.

## Access-control contract

- Workspace identity is derived from the authenticated Better Auth session. Request bodies never grant tenant access.
- Thread and message APIs require membership in the owning workspace. External access requires a record-specific, expiring participant token.
- SMS sends require active consent for the exact workspace, destination, scope, and country rules. STOP immediately overrides earlier consent.
- Provider-health responses never contain credentials or raw OAuth tokens. Platform-wide health, retries, feature flags, and Integration Vault mutations are master-admin only.
- AI reads return bounded summaries rather than secrets or unrestricted records.
- AI writes use a two-step proposal and confirmation flow. Execution rechecks the actor, workspace, proposal expiry, target ownership, and current target state.
- Provider callbacks are authorized by provider signatures, not browser sessions, and are idempotent.

These rules are compatibility requirements for backend APIs and any frontend consuming them.
