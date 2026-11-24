# Live Stripe catalog

Verified on **2026-11-24** for Zenvio, LLC (`stripe_their-torsel`), live mode.
The initial inspection was read-only; the approved legacy archive was executed
later the same day and verified.

## Canonical products and prices

| Plan | Product | Period | Price | Amount |
|---|---|---|---:|---:|
| Free | `zenvio_free_v4` | — | none | $0 |
| Starter | `zenvio_starter_v4` | monthly | `price_1Uf856QMz0wiUqo0uJsbCAd7` | $9.99 |
| Starter | `zenvio_starter_v4` | annual | `price_1Uf856QMz0wiUqo031WwUUOC` | $95.88 |
| Professional | `zenvio_professional_v4` | monthly | `price_1Uf856QMz0wiUqo01Os8BxRH` | $19.99 |
| Professional | `zenvio_professional_v4` | annual | `price_1Uf856QMz0wiUqo0Cg8swKNk` | $191.88 |
| Team (`business`) | `zenvio_business_v4` | monthly | `price_1Uf856QMz0wiUqo0Swg6Qqk0` | $34.99 |
| Team (`business`) | `zenvio_business_v4` | annual | `price_1Uf856QMz0wiUqo03dCh5asi` | $335.88 |
| Additional seat | `zenvio_business_extra_v4` | monthly | `price_1Uf856QMz0wiUqo0usROIFRC` | $5.00 |
| Additional seat | `zenvio_business_extra_v4` | annual | `price_1Uf856QMz0wiUqo08pX6WTJv` | $48.00 |

Every product and price is active and carries
`zenvio_catalog_version=2026-11-v4`, `zenvio_environment=live` and the plan /
interval metadata. The eight subscription prices match
`src/lib/pricing-catalog.mjs` exactly. `business_extra` reuses the additional
seat price. The catalog has eight subscription prices and eight add-on prices.

## Add-on products and prices

| Add-on | Product | Price | Amount | Type |
|---|---|---|---:|---|
| 100 AI credits | `zenvio_addon_ai_100` | `price_1Uf85EQMz0wiUqo0iQw4PDVk` | $2.99 | one-time |
| 500 AI credits | `zenvio_addon_ai_500` | `price_1Uf85EQMz0wiUqo05lgnylml` | $9.99 | one-time |
| 10 e-sign envelopes | `zenvio_addon_envelopes_10` | `price_1Uf85EQMz0wiUqo0TobtfVwI` | $9.99 | one-time |
| Individual envelope | `zenvio_addon_envelope_1` | `price_1Uf85EQMz0wiUqo0zRBS3bD6` | $1.00 | one-time |
| 1,000 video minutes | `zenvio_addon_video_1000` | `price_1Uf85EQMz0wiUqo0WIOYh6uy` | $9.99 | one-time |
| Additional 10 GB storage | `zenvio_addon_storage_10gb` | `price_1Uf85EQMz0wiUqo0SwGwRlu4` | $2.99 | monthly |
| SMS Starter | `zenvio_addon_sms_starter` | `price_1Uf85EQMz0wiUqo0oxQK8EBT` | $14.99 | monthly |
| Additional SMS segment | `zenvio_addon_sms_segment` | `price_1Uf85EQMz0wiUqo0oUCA0aO5` | $0.03 | one-time |

All add-ons remain `available=false` in the public catalog until their own
fulfillment and refund acceptance is recorded. Purchase is additionally gated
by `ADDON_BILLING_VALIDATED`.

## Legacy resources — archived 2026-11-24 21:39:25 UTC

| Product | Name | Price | Amount | Interval | Active | Subscriptions |
|---|---|---|---|---:|---|---:|
| `zenvio_individual_v3` | Zenvio Individual | `price_1Ub1VgQMz0wiUqo0UYVNvW7S` | $29.99 | month | no | 0 |
| `zenvio_team_v3` | Zenvio Teams | `price_1Ub1VgQMz0wiUqo0jDrlP5hA` | $49.99 | month | no | 0 |
| `zenvio_team_extra_v3` | Zenvio Additional team seat | `price_1Ub1VhQMz0wiUqo075WFAtf9` | $9.99 | month | no | 0 |

The live account reported **zero subscriptions** (status `all`) immediately
before archiving, so none of these legacy prices was referenced by a renewal or
grandfathered subscription. All three prices and all three products now report
`active=false`; they remain readable for historic records but cannot be selected
for new purchases. See [the archive manifest](stripe-legacy-archive-manifest.md).
