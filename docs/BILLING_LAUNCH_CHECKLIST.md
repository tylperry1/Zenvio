# Billing launch checklist

Paid checkout stays closed until every item below is true. The same list is
shown in Master Admin → Billing & Pricing.

## 1. Configuration

- [ ] `src/lib/pricing-catalog.mjs` is the deployed source of prices.
- [ ] Approved prices unchanged: Starter $9.99/$95.88, Professional
      $19.99/$191.88, Team $34.99/$335.88, extra seat $5.00/$48.00.
- [ ] Team includes 3 seats; extra seats bill only above 3.

## 2. Stripe environment boundary

- [ ] Production has a live key; preview/staging has a test key.
- [ ] `billingReadiness()` reports the key matches the deployment.
- [ ] No live key is used for acceptance testing.

## 3. Pricing configuration in Stripe

- [ ] One product per sellable plan: `zenvio_starter_v4`,
      `zenvio_professional_v4`, `zenvio_business_v4`,
      `zenvio_business_extra_v4`.
- [ ] One monthly and one annual Price per plan, amounts equal to the catalog.
- [ ] `private.subscription_prices` maps each plan+period to that Price under
      `CATALOG_ID` (`2026-11-v4`).
- [ ] No duplicate or deleted products/prices.

## 4. Webhook

- [ ] One signing secret configured for the production endpoint.
- [ ] Required events include checkout completion/expiry, subscription
      create/update/delete, and invoice payment failure/success.
- [ ] A forged request is rejected (400) and an unsigned one is rejected.

## 5. Test acceptance

- [ ] In Stripe test mode: Starter, Professional, Team (3 seats) and Team with
      extra seats complete checkout.
- [ ] Monthly and annual each charge the catalog amount.
- [ ] Upgrade and downgrade produce the quoted proration.
- [ ] Webhook updates the local subscription, seats and allowance.
- [ ] Cancellation and resubscribe behave correctly.
- [ ] Record the acceptance (reviewer, date, Stripe test ids) and set
      `BILLING_VALIDATED=true` for that environment.
- [ ] `sandboxAccepted()` is recorded.

## 6. Enablement

- [ ] Master Admin shows three plans, prices, seats, Stripe mapping, readiness,
      webhook health, subscription totals and revenue.
- [ ] Every readiness blocker is cleared.
- [ ] Owner enables paid checkout from Master Admin with
      `ENABLE_PAID_ENROLLMENT`; no SQL and no manual database edit.
- [ ] Public pricing page stops showing preview-only copy.
- [ ] Checkout is refused while any blocker remains.

## 7. Customer-facing review

- [ ] Only Starter, Professional and Team appear.
- [ ] No v3/v4, catalog version, internal key or legacy wording appears.
- [ ] Monthly and annual prices are both shown; annual is labelled as a yearly
      total.
- [ ] Extra-seat pricing appears only where seats are relevant.
- [ ] No unfinished add-on is offered.

## 8. Operational checks

- [ ] `/api/health` returns 200.
- [ ] `/api/pricing` returns the canonical plans with `previewOnly: false`.
- [ ] `/api/billing` returns 401 when signed out.
- [ ] Revenue reporting matches Stripe for the month.
- [ ] Rollback: revert the application deploy; no data migration to undo.

## Known external blockers at the time of this change

- No Stripe test key in this environment, so test acceptance has not been run.
- The live Stripe key is read-only, so webhook events could not be added.
- No database integration for PITR verification.
- `BILLING_VALIDATED` is not set in production.
