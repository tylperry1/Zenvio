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

## Implemented on the backend branch

- Published shared contracts before implementation in draft PR #15.
- Environment-specific Gemini/Workers AI/Anthropic selection, no fallback, privacy/tool approval gates, synthetic probe, token/cost ledger and serialized platform/team spend reservations.
- Telnyx durable outbox wired to both SMS APIs/inbox; signature/replay validation, transactional callbacks, consent/registration gates, usage reservations, inbound replies and explicit uncertain outcomes. Twilio history retained.
- Daily appointment-scoped private rooms and short-lived host/guest access; gated R2 private uploads/scanner and owner-scoped signed downloads.
- Transactional internal package/gift-card/loyalty balances with idempotency, single-use reversals and audit.
- Sequential signing, optional PNG signature evidence, final-document caching/hash checks and immutable evidence trigger; no independent identity claim.
- Atomic free recurring appointment series with timezone/DST rules and existing booking/provider conflict checks.
- Printful real read-only catalog adapter; automatic supplier orders remain unavailable.
- Actual-data admin aggregation, Stripe-derived revenue snapshots with incomplete/null coverage, added export/retention blockers.
- Microsoft conflicts included in assistant rescheduling; scheduled runner now drains both calendar queues; calendar answers require explicit host opt-in.

## Observed validation

- Local: 15 provider/security/accounting unit tests and 11 scheduling/calendar/recurrence tests pass. Full local build/typecheck attempts stalled on cloud-offloaded dependency files; these are not counted as passes.
- Initial CI 41234363288 failed: restored SMS readiness blocker ordering and extended test module loaders for new dependencies. Failures were repaired, not waived.
- CI 41234671414 passed both jobs on 18174ea: unit suite, retained-record migrations, production build/typecheck, new ledger concurrency fixture, legacy API suites, experience API/browser suites, responsive QA and staff permissions.
- CI 41235050569 passed both jobs on 0e1be97, including sequential evidence and recurring atomicity tests.
- Later concurrency-hardening/final revision needs its own CI result before this gate is considered passed. See final PR evidence.

## Explicit remaining scope

The full roadmap remains incomplete. External calendar editing, automated SMS reminders, exclusive waitlist holds, automatic no-show fees, multi-location/travel/service areas, paid recurring appointments, rewards/referrals/reviews/conversion journeys, advanced payment schedules, supplier ordering/returns/refunds, actual Daily usage ingestion and new widgets/mini-sites still require implementation or acceptance. Customer commerce and inbound email now exist but require final-revision CI, frontend adoption and authorized provider tests.

## October 31 continuation

- Classes/group sessions reserve the organizer once, enforce capacity transactionally, support credit admission and return credits on cancellation. Backend run 41240292002 and combined frontend run 41240308864 passed both CI jobs.
- Customer commerce adds server-priced packages, monthly memberships, gift cards, coupon reservations, signed Connect reconciliation, exactly-once credit grants and proportional refund recovery. Spent refunded credits freeze debits and record debt; no additional charge is made.
- Inbound email uses separate signed webhooks, provider-reported authentication, private reply aliases and exact participant matching. HTML-only messages are quarantined and attachments withheld.
- Commerce CI found a nullable Stripe amount type error; an explicit numeric guard was committed. Final backend and integration reruns are pending.
- Review branches: backend PR #15; unchanged Claude frontend PR #16; combined staging-review PR #17. No production merge or promotion.
- Additive migrations 049–052 supplement 041–048. No previously applied migration was rewritten.

## Migration and deployment policy

New files: 041_launch_provider_accounting, 042_private_file_references, 043_subscription_revenue_snapshots, 044_signing_evidence_and_routing, 045_recurring_booking_series, 046_waitlists_and_attendance, 047_waitlist_recipient_snapshots. Existing production migrations and data are unchanged. Apply only after integrated staging passes and a production database backup/restore checkpoint is confirmed. Use forward fixes rather than rewriting migration history. Provider features remain off until approved acceptance. No merge or production promotion is performed by this workstream.

CI 41235198572 passed both jobs on c2892b9 (183 unit tests and all configured migration/API/browser/retained-record/security checks). CI 41235555088 passed both jobs on 14c7d52, including emergency-suspension hardening. Waitlists/attendance were subsequently added and require their own final-revision result. Local provider regression tests now pass 17/17; scheduling/calendar/recurrence 11/11. No whole-platform launch certification is inferred.

Additional forward migrations: 047 binds offer recipients; 048 corrects pending cancellation-event queue cleanup. A legacy Google fixture exposed that an otherwise empty account could not be deleted because its operational cancellation event had a restrictive FK. 048 cascades only those queue rows; opted-in waitlists/offers and financial/document histories retain their deletion protections. Existing migrations were not rewritten.
