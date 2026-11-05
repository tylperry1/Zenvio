# Smart Cards release checklist

- [x] Reuse the workspace Smart Cards editor, Better Auth sessions, private profile tables, contact CRM, and existing marketplace.
- [x] Keep /p/{slug} and /c/{token} as the permanent URLs for profiles and physical links.
- [x] Make new profiles private until explicitly published. Reserve archived addresses and preserve current published profiles.
- [x] Export QR as PNG or SVG and generate vCard 3.0 from public fields only.
- [x] Require visitor consent before accepting contact details. Limit submissions per IP and profile, deduplicate CRM contacts, and store the first submission date for attribution. This consent covers follow-up on the submitted request.
- [x] Record aggregate link visits, booking link visits, vCard downloads, and attributed contacts. The reporting window uses UTC dates and counts events, which can include repeat visits and link previews.
- [x] Require owner confirmation before activating newly registered physical links. Record registration, activation, deactivation and reassignment in the same database statement as the change.
- [ ] Verify migration 065 and the browser fixture in the GitHub upgrade workflow before merging.
- [ ] Build Apple PassKit signing with vault-backed Pass Type ID, certificate and key, and validate on device before showing the action.
- [ ] Build Google Wallet Generic issuance with vault-backed credentials, verify publishing access and test on device before showing the action.
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
