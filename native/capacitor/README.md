# Zenvio NFC Capacitor shell

This companion shell hosts the existing Zenvio web app and exposes Core NFC / Android NFC through the `ZenvioNfc` bridge (`window.ZenvioNfc`).

It is **not** a rewrite of Zenvio. Point `server.url` at your HTTPS staging or production origin.

## Why this exists

Safari and ordinary web pages on iPhone **cannot** access Core NFC. Android Chrome may offer Web NFC (NDEF only) in a secure context. Full iOS/Android programming requires this native shell.

## Setup (outline)

1. Install Capacitor CLI and sync this project against the live Zenvio URL.
2. Copy `ios/App/App/Plugins/ZenvioNfcPlugin.swift` into the iOS app target.
3. Copy `android/.../ZenvioNfcPlugin.kt` into the Android app module.
4. Install a thin JS bridge that assigns `window.ZenvioNfc` **before** NFC Studio mounts (Capacitor plugin registration / injected script). The web adapter selects once on first `getNfcAdapter()` call — call `resetNfcAdapterCache()` if the bridge appears later.
5. Enable NFC entitlements / permissions (below).
6. Build signed TestFlight / internal Play builds for device QA.

## iOS requirements

- Apple Developer App ID with **Near Field Communication Tag Reading**
- Entitlements: `com.apple.developer.nfc.readersession.formats` → `NDEF`
- Info.plist: `NFCReaderUsageDescription`
- Signing certificate + provisioning profile
- Physical device with NFC (not Simulator)

**Write status:** iOS `canWrite` is **false** until Core NFC `NFCNDEFMessage` assembly from serialized bytes is finished. Read and lock remain available when Core NFC is present. Do not claim iPhone write works in UI or marketing until that lands and is device-tested.

## Android requirements

- `android.permission.NFC`
- Optional `uses-feature android.hardware.nfc`
- Signed APK/AAB
- Physical NFC device

Android `canWrite` may be true when NFC is enabled. The web layer serializes NDEF and passes `ndefBase64` into the plugin.

## Bridge contract

`window.ZenvioNfc` must implement:

- `getCapabilities()` → `NfcCapabilities` (honest `canWrite` / `canRead` / `canMakeReadOnly`)
- `startReading()` → `ReadResult` with `tag.message` (structured records) and/or `tag.messageBase64`
- `stopReading()`
- `writeNdef({ ndefBase64, overwriteConfirmed })` — **pre-serialized** NDEF message from `serializeNdef` in the web layer (base64). Do not pass raw editor records.
- `makeReadOnly()`
- `cancelOperation()` — must complete any pending read/write/lock callback as cancelled

Return shapes match `src/lib/nfc/types.ts`. The web adapter in `src/lib/nfc/capacitor-bridge.ts` hydrates `messageBase64` via `parseNdef` when structured records are absent.

## Status

Plugin sources are provided for integration. **Physical-device NFC verification is not complete in the cloud agent environment.** Do not publish store builds without device QA and explicit approval. Do not claim device NFC works until the bridge is installed, signed, and tested on hardware.
