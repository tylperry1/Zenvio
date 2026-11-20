# Zenvio NFC Capacitor shell

This companion shell hosts the existing Zenvio web app and exposes Core NFC / Android NFC through the `ZenvioNfc` bridge (`window.ZenvioNfc`).

It is **not** a rewrite of Zenvio. Point `server.url` at your HTTPS staging or production origin.

## Why this exists

Safari and ordinary web pages on iPhone **cannot** access Core NFC. Android Chrome may offer Web NFC (NDEF only) in a secure context. Full iOS/Android programming requires this native shell.

## Setup (outline)

1. Install Capacitor CLI and sync this project against the live Zenvio URL.
2. Copy `ios/App/App/Plugins/ZenvioNfcPlugin.swift` into the iOS app target.
3. Copy `android/.../ZenvioNfcPlugin.kt` into the Android app module.
4. Enable NFC entitlements / permissions (below).
5. Build signed TestFlight / internal Play builds for device QA.

## iOS requirements

- Apple Developer App ID with **Near Field Communication Tag Reading**
- Entitlements: `com.apple.developer.nfc.readersession.formats` → `NDEF`
- Info.plist: `NFCReaderUsageDescription`
- Signing certificate + provisioning profile
- Physical device with NFC (not Simulator)

## Android requirements

- `android.permission.NFC`
- Optional `uses-feature android.hardware.nfc`
- Signed APK/AAB
- Physical NFC device

## Bridge contract

`window.ZenvioNfc` must implement:

- `getCapabilities()`
- `startReading()`
- `stopReading()`
- `writeNdef({ records, overwriteConfirmed })`
- `makeReadOnly()`
- `cancelOperation()`

Return shapes match `src/lib/nfc/types.ts`.

## Status

Plugin sources are provided for integration. **Physical-device NFC verification is not complete in the cloud agent environment.** Do not publish store builds without device QA and explicit approval.
