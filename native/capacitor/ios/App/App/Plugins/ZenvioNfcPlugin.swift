import Foundation
import CoreNFC
import WebKit

/// Capacitor / WKWebView bridge for Zenvio NFC Studio (NDEF only via Core NFC).
/// Requires Near Field Communication Tag Reading entitlement and a physical iPhone.
@objc(ZenvioNfcPlugin)
class ZenvioNfcPlugin: NSObject, NFCNDEFReaderSessionDelegate {
  private var session: NFCNDEFReaderSession?
  private var pendingResolve: (([String: Any]) -> Void)?
  private var mode: String = "read"
  private var writePayload: Data?
  private var overwriteConfirmed = false

  @objc func getCapabilities(_ call: @escaping ([String: Any]) -> Void) {
    let available = NFCNDEFReaderSession.readingAvailable
    call([
      "state": available ? "ready" : "unsupported",
      "platform": "ios-native",
      "canRead": available,
      "canWrite": available,
      "canMakeReadOnly": available,
      "canFormat": false,
      "detail": available
        ? "Core NFC NDEF is available on this iPhone."
        : "This iPhone does not support Core NFC NDEF sessions.",
    ])
  }

  @objc func startReading(_ call: @escaping ([String: Any]) -> Void) {
    guard NFCNDEFReaderSession.readingAvailable else {
      call(["ok": false, "errorCode": "unsupported", "errorMessage": "Core NFC is unavailable."])
      return
    }
    mode = "read"
    pendingResolve = call
    let s = NFCNDEFReaderSession(delegate: self, queue: nil, invalidateAfterFirstRead: true)
    s.alertMessage = "Hold your iPhone near the NFC tag."
    session = s
    s.begin()
  }

  @objc func writeNdef(_ payloadJson: String, overwriteConfirmed: Bool, call: @escaping ([String: Any]) -> Void) {
    guard NFCNDEFReaderSession.readingAvailable else {
      call(["ok": false, "verified": false, "errorCode": "unsupported", "errorMessage": "Core NFC is unavailable."])
      return
    }
    guard overwriteConfirmed else {
      call(["ok": false, "verified": false, "errorCode": "confirm_overwrite", "errorMessage": "Confirm overwrite before writing."])
      return
    }
    // Expect base64 NDEF bytes from the web layer for exact write+verify.
    guard let data = Data(base64Encoded: payloadJson) else {
      call(["ok": false, "verified": false, "errorCode": "invalid_payload", "errorMessage": "Invalid NDEF payload."])
      return
    }
    mode = "write"
    writePayload = data
    self.overwriteConfirmed = overwriteConfirmed
    pendingResolve = call
    let s = NFCNDEFReaderSession(delegate: self, queue: nil, invalidateAfterFirstRead: false)
    s.alertMessage = "Hold your iPhone near a writable NFC tag."
    session = s
    s.begin()
  }

  @objc func makeReadOnly(_ call: @escaping ([String: Any]) -> Void) {
    guard NFCNDEFReaderSession.readingAvailable else {
      call(["ok": false, "errorCode": "unsupported", "errorMessage": "Core NFC is unavailable."])
      return
    }
    mode = "lock"
    pendingResolve = call
    let s = NFCNDEFReaderSession(delegate: self, queue: nil, invalidateAfterFirstRead: false)
    s.alertMessage = "Hold near the tag to make it permanently read-only."
    session = s
    s.begin()
  }

  @objc func cancelOperation(_ call: @escaping ([String: Any]) -> Void) {
    session?.invalidate()
    session = nil
    pendingResolve?(["ok": false, "errorCode": "cancelled", "errorMessage": "Cancelled."])
    pendingResolve = nil
    call(["ok": true])
  }

  func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
    let ns = error as NSError
    if ns.code == 200 { return } // user cancel already handled
    pendingResolve?([
      "ok": false,
      "verified": false,
      "errorCode": "session",
      "errorMessage": error.localizedDescription,
    ])
    pendingResolve = nil
  }

  func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {
    // Fallback path for read-only detection of messages.
    if mode == "read" {
      pendingResolve?(["ok": true, "tag": ["ndefSupported": true]])
      pendingResolve = nil
    }
  }

  func readerSession(_ session: NFCNDEFReaderSession, didDetect tags: [NFCNDEFTag]) {
    guard let tag = tags.first else { return }
    session.connect(to: tag) { [weak self] error in
      guard let self = self else { return }
      if let error = error {
        self.pendingResolve?(["ok": false, "errorCode": "connect", "errorMessage": error.localizedDescription])
        self.pendingResolve = nil
        session.invalidate()
        return
      }
      tag.queryNDEFStatus { status, capacity, error in
        if let error = error {
          self.pendingResolve?(["ok": false, "errorCode": "status", "errorMessage": error.localizedDescription])
          self.pendingResolve = nil
          session.invalidate()
          return
        }
        if self.mode == "read" {
          tag.readNDEF { message, error in
            if let error = error {
              self.pendingResolve?(["ok": false, "errorCode": "read_failed", "errorMessage": error.localizedDescription])
            } else {
              self.pendingResolve?([
                "ok": true,
                "tag": [
                  "ndefSupported": true,
                  "writable": status == .readWrite,
                  "readOnly": status == .readOnly,
                  "capacityBytes": capacity,
                ],
              ])
            }
            self.pendingResolve = nil
            session.invalidate()
          }
          return
        }
        if self.mode == "write" {
          guard status == .readWrite else {
            self.pendingResolve?(["ok": false, "verified": false, "errorCode": "read_only", "errorMessage": "Tag is not writable."])
            self.pendingResolve = nil
            session.invalidate()
            return
          }
          // Production integration should convert writePayload Data into NFCNDEFMessage records.
          self.pendingResolve?([
            "ok": false,
            "verified": false,
            "errorCode": "integration_pending",
            "errorMessage": "Wire serialized NDEF records into NFCNDEFMessage before device release.",
          ])
          self.pendingResolve = nil
          session.invalidate()
          return
        }
        if self.mode == "lock" {
          tag.writeLock { error in
            if let error = error {
              self.pendingResolve?(["ok": false, "errorCode": "lock_failed", "errorMessage": error.localizedDescription])
            } else {
              self.pendingResolve?(["ok": true])
            }
            self.pendingResolve = nil
            session.invalidate()
          }
        }
      }
    }
  }
}
