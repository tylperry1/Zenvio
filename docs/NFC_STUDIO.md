# Zenvio NFC Studio

Production feature for reading, writing, and programming NFC tags with Zenvio Smart Cards.

## Architecture

See the Phase 0 note in the agent store (`internal/nfc-studio-architecture.md`) for discovery details.

- **Web app (Vercel):** UI, APIs, NDEF helpers, Tag Manager, history, admin.
- **Web NFC:** optional Android Chrome path when `NDEFReader` exists (NDEF only).
- **Capacitor shell:** required for iPhone Core NFC and preferred for Android native NFC (`native/capacitor/`).

**iPhone Safari cannot perform NFC.** The Studio reports `native_unavailable` / `browser_unavailable` honestly and disables Scan/Write.

## Routes

| Path | Purpose |
| --- | --- |
| `/app/smart-cards/nfc-studio` | NFC Studio |
| `/api/nfc/*` | Tag registry, operations, batches, overview |
| `/admin/nfc` | Master Admin monitoring + enable toggle |
| `/c/{token}` | Existing Smart Card redirect (program this URL onto tags) |

## Security

- Authenticated owner scope (same model as Smart Cards).
- Same-origin POSTs.
- Scanned URLs never auto-open.
- Overwrite and permanent lock require explicit confirmation.
- Launch feature flag `smartCards` gates `/app/smart-cards` and `/api/nfc`.

## Device QA (required before claiming NFC works)

Physical matrix for NTAG213/215/216 on iPhone (Capacitor) and Android (Capacitor + Web NFC where available): read, write, verify, read-only tag, unsupported tag, tag removed mid-session, cancel.

Do not mark physical testing complete without device results. Do not deploy or publish store builds without explicit approval.
