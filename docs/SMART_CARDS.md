# Smart Cards release checklist

- [x] Reuse the workspace Smart Cards editor, Better Auth sessions, private profile tables, contact CRM, and existing marketplace.
- [x] Keep /p/{slug} and /c/{token} as the permanent URLs for profiles and physical links.
- [x] Make new profiles private until explicitly published. Reserve archived addresses and preserve current published profiles.
- [x] Export QR as PNG or SVG and generate vCard 3.0 from public fields only.
- [x] Require visitor consent before accepting contact details. Limit submissions per IP and profile, deduplicate CRM contacts, and store the first submission date for attribution. This consent covers follow-up on the submitted request.
- [x] Record aggregate link visits, booking link visits, vCard downloads, and attributed contacts. The reporting window uses UTC dates and counts events, which can include repeat visits and link previews.
- [x] Require owner confirmation before activating newly registered physical links. Record registration, activation, deactivation and reassignment in the same database statement as the change.
- [ ] Verify migration 065 and the browser fixture in the GitHub upgrade workflow before merging.
- [x] Implement Apple PassKit QR pass signing using vault credentials.
- [ ] Verify with an Apple-issued certificate on iPhone before enabling production issuance.
- [x] Implement Google Wallet Generic issuance and refresh using vault credentials.
- [ ] Verify Google issuer publishing access and test on Android before enabling production issuance.
- [ ] Qualify a physical NFC supplier and validate encoding, personalization, shipping, refunds and margins before publishing a marketplace SKU.
- [ ] Add organization-scoped staff cards and seat-linked limits using the existing entitlement system. This release keeps the existing owner-scoped limits and account permissions.
- [ ] Add Smart Cards admin reporting, team templates, branded media uploads, bulk fulfillment and notifications.

## Manual encoding

Register the tag under Smart Cards and copy its /c/ URL. Write that exact URL as an NDEF URL record with a compatible NFC writer. Read the record back, then activate the link in Zenvio and verify it on a compatible phone. The recorded confirmation represents the owner's attestation. To replace a lost tag, deactivate its old link and register a new tag with a fresh URL. Existing active tags keep their original URLs.

## Public endpoints

- GET /p/{slug} renders the published profile.
- GET /p/{slug}/qr?format=png or format=svg downloads a QR code for the published profile.
- GET /p/{slug}/vcard downloads the visible contact fields.
- GET /p/{slug}/booking records a visit and redirects to the profile owner's Zenvio booking page.
- POST /p/{slug}/lead records consent and adds or attributes a CRM contact when lead capture is enabled.
- GET /api/smart-profiles?days=7, 30 or 90 reads the signed-in owner's cards and engagement.


## Wallet activation

Both providers are off by default. Published card owners see each Wallet action under Share when its release flag and credential fields are present. Issuance requires a same-origin POST and an authenticated owner. The passes contain public identity fields and a QR code to the live profile, so unpublishing disables the QR destination. Saved passes may continue to display previously issued text. Apple owners can re-add the pass to refresh it. Google refreshes the existing object when the owner clicks Add to Google Wallet again.

In Admin → Connections, enter the provider credentials into the Integration Vault. For single-line PEM fields, represent each line break with a literal backslash followed by n. Environment variables with the same names are also supported. Never commit the private key files.

- **Apple Wallet** uses the Pass Type ID, Apple Team ID, signing certificate, unencrypted signing key and the matching Apple WWDR intermediate. Validate a test pass on an iPhone, then set `SMART_CARDS_APPLE_WALLET_ENABLED=true` in the production environment. Verify the QR link and test re-adding after an edit. Monitor and renew the signing certificate before expiry. The issuer rejects expired or mismatched certificates.
- **Google Wallet** uses an existing Generic Class ID, the service account email and its private key. Enable the Wallet API, grant the service account issuer access, and test in demo mode with an approved test account. Obtain publishing access, then set `SMART_CARDS_GOOGLE_WALLET_ENABLED=true` in production.
- Use an isolated database and the corresponding feature flags for acceptance testing. Configure `NEXT_PUBLIC_APP_URL` to the HTTPS base URL that the generated QR codes should open.
- Neither provider uses physical NFC encoding. Installed-pass revocation and Apple push updates are outside this release.
