# November 16 release acceptance
- Launch controls: /admin/launch. Existing login is independent from public signup.
- Billing: /admin/billing. Drafts are safe; publication and provider mutations require sandbox acceptance.
- Sandbox keys are separate vault entries. Point test-mode subscription lifecycle events to /api/billing/sandbox-webhook; run the isolated lifecycle, then verify signed event receipt.
- No automatic repricing: existing subscription IDs retain their mapped catalog and allowances until an explicit previewed change.
- Deactivate accounts with retained financial/legal records; do not erase history.
- CI runs disposable PostgreSQL migrations and a full dump/restore drill. This is not proof of production Neon PITR retention. Confirm that retention and a recovery owner before opening public paid checkout.
- Provider probes use existing Connections controls. Leave unverified provider features disabled.
