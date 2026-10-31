# Zenvio 3.0 launch readiness

Target: November 2, 2026. Current gate: **NOT READY for unrestricted commercial activation**.
Baseline: e65f4f67ca68f0ab7452d68924a93972a3cc81ec. Worktree: launch/codex-backend.

Current evidence: existing full QA report docs/qa/ZENVIO_2_0_FULL_QA_AUDIT.md describes earlier passing isolated CI and unresolved live-provider acceptance. That evidence does not validate changes on this branch.

## Release gates

- [ ] Typecheck, full unit suite, production build and isolated Postgres migrations pass on final revision.
- [ ] Tenant isolation, booking concurrency and existing browser fixtures pass on final revision.
- [ ] Stripe Billing test-mode checkout/annual/seats/portal/failure/cancel/reconciliation accepted.
- [ ] Connect Express test-mode onboarding/deposit/refund/reconciliation accepted.
- [ ] Approved recurring price mapping, webhook secrets and early-adopter coupon validated privately.
- [ ] Resend sender, receipt/replay/suppression/bounce accepted with authorized test address.
- [ ] Google/Microsoft real OAuth, refresh, DST/conflicts/export/cancel/recovery accepted.
- [ ] Telnyx approved sender/campaign, consent, inbound/delivery/replay and uncertain-send recovery accepted before SMS flag.
- [ ] AI approved private-data terms, model/tools, per-environment settings and hard budget reservations accepted before activation.
- [ ] Daily private room/access/expiration and usage accepted before activation.
- [ ] Private R2 bucket/authorization/scanning and signed downloads accepted before use.
- [ ] Supplier commercial terms and authorized test fulfillment accepted before purchases.
- [ ] Frontend/backend integrated in staging; owner approves production release.

No paid checkout, provider flag, secret or production data is changed by this branch. No live charges or supplier orders are authorized for tests. Existing applied migrations must retain checksums. A provider being configured never certifies its acceptance.

## Environment limitations

Original macOS checkout uses dataless cloud Git objects; shell GitHub DNS fails. Exact current GitHub snapshot was reconstructed with blob/tree/commit SHA checks through the GitHub connector. Worktree is isolated in /tmp/zenvio-backend. Existing checkout remains untouched apart from the initially attempted worktree metadata. Dependency cache is incomplete; isolated CI is required for full validation.
