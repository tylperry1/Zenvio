# Digital Identity ecosystem

Digital Profiles are the central identity layer for Zenvio Smart Cards, NFC Studio, QR codes, booking, contact exchange, and analytics.

## Canonical model

- One authoritative record: `private.smart_profiles` (Digital Identity).
- One canonical public URL: `/p/{slug}`.
- Physical products encode the stable card redirect `/c/{token}` (NFC adds `?src=nfc`).
- Content edits update the live profile without reprogramming QR codes or NFC tags.
- Slug changes keep prior addresses working via `private.smart_profile_slug_redirects`.

## Profile kinds

`individual` · `business` · `employee` · `team` · `brand`

Visibility: `public` · `unlisted` · `private` (private is unpublished).

## Management Center

In-app navigation: **Digital Identity**

| Section | Route |
| --- | --- |
| My Profiles | `/app/identity` |
| Smart Cards | `/app/identity/cards` |
| NFC Studio | `/app/identity/nfc` → `/app/smart-cards/nfc-studio` |
| QR Codes | `/app/identity/qr` |
| Contact Exchange | `/app/identity/contacts` |
| Analytics | `/app/identity/analytics` |
| Design & Branding | `/app/identity/design` |

Legacy entry points (Business Profile → Digital Card, Growth → Digital Identity) deep-link into this center.

## Connected products

| Product | Behavior |
| --- | --- |
| Smart Cards | Create/connect cards to a profile; change destination without replacing the physical card; engagement via `/c/{token}` |
| NFC Studio | Write/read where device supports it; programs `/c/{token}?src=nfc`; honest capability messaging (no iPhone Safari write claims) |
| QR | `/p/{slug}/qr?format=png\|svg` encodes `/p/{slug}?via=qr` |
| Booking | Profile “Book a time” → `/p/{slug}/booking` → owner booking page with `src=smart-card` |
| Contact | vCard download, share/copy, privacy toggles, optional lead capture |
| Analytics | Views by `link`/`card`/`qr`/`nfc`; actions; verified booking conversions only from `booking_sources` |

## Entitlements

Launch flag `features.smartCards` gates the surface. Capacity defaults remain **5 profiles / 50 cards / 100 NFC tags** — the same historical Smart Cards ceilings. This work does **not** invent Stripe prices or change catalog amounts. Upgrade copy points users to Plan & billing when a ceiling is reached.

## Security

All mutations require an authenticated owner (`user_id`) and same-origin POST. Users cannot modify another account’s profiles, cards, NFC destinations, or analytics.

## Acceptance checklist

1. Create and publish a Digital Identity.
2. Generate QR → open `/p/{slug}?via=qr` without signing in.
3. Register/connect a Smart Card; preview `/c/{token}`.
4. In NFC Studio, write the card URL on a compatible device; scan opens the public profile.
5. Book from the profile; confirm `booking_sources` attribution when a booking completes.
6. Save contact (vCard); confirm analytics counters.
7. Edit profile content (and optionally slug); existing QR and NFC destinations still resolve.
8. Verify iPhone Safari, Android Chrome, and desktop browsers for the public profile page.
