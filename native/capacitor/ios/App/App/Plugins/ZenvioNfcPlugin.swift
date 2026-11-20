import Foundation
import CoreNFC
import WebKit

/// Capacitor / WKWebView bridge for Zenvio NFC Studio (NDEF only via Core NFC).
/// Requires Near Field Communication Tag Reading entitlement and a physical iPhone.
/// Writing is intentionally reported unavailable until NFCNDEFMessage assembly is finished.
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
      // Write stays false until serialized NDEF → NFCNDEFMessage assembly ships.
      "canWrite": false,
      "canMakeReadOnly": available,
      "canFormat": false,
      "detail": available
        ? "Core NFC read/lock is available. Writing is not enabled until native message assembly is finished."
        : "This iPhone does not support Core NFC NDEF sessions.",
    ])
  }

  @objc func startReading(_ call: @escaping ([String: Any]) -> Void) {
    guard NFCNDEFReaderSession.readingAvailable else {
      call(["ok": false, "errorCode": "unsupported", "errorMessage": "Core NFC is unavailable."])
      return
    }
    beginOperation(mode: "read", resolve: call, alert: "Hold your iPhone near the NFC tag.", invalidateAfterFirstRead: true)
  }

  @objc func writeNdef(_ payloadJson: String, overwriteConfirmed: Bool, call: @escaping ([String: Any]) -> Void) {
    // Honest scaffold: do not claim write until message assembly is implemented.
    call([
      "ok": false,
      "verified": false,
      "errorCode": "integration_pending",
      "errorMessage": "iOS NFC writing is not enabled yet. Use Android native or Web NFC until Core NFC write assembly ships.",
    ])
  }

  @objc func makeReadOnly(_ call: @escaping ([String: Any]) -> Void) {
    guard NFCNDEFReaderSession.readingAvailable else {
      call(["ok": false, "errorCode": "unsupported", "errorMessage": "Core NFC is unavailable."])
      return
    }
    beginOperation(mode: "lock", resolve: call, alert: "Hold near the tag to make it permanently read-only.", invalidateAfterFirstRead: false)
  }

  @objc func cancelOperation(_ call: @escaping ([String: Any]) -> Void) {
    let active = session
    completePending([
      "ok": false,
      "verified": false,
      "errorCode": "cancelled",
      "errorMessage": "Cancelled.",
    ], for: active)
    active?.invalidate()
    session = nil
    call(["ok": true])
  }

  private func beginOperation(mode: String, resolve: @escaping ([String: Any]) -> Void, alert: String, invalidateAfterFirstRead: Bool) {
    // Reject overlapping sessions so pendingResolve cannot be stolen by a newer call.
    if session != nil || pendingResolve != nil {
      resolve(["ok": false, "errorCode": "busy", "errorMessage": "Another NFC operation is already in progress."])
      return
    }
    self.mode = mode
    pendingResolve = resolve
    let s = NFCNDEFReaderSession(delegate: self, queue: nil, invalidateAfterFirstRead: invalidateAfterFirstRead)
    s.alertMessage = alert
    session = s
    s.begin()
  }

  private func completePending(_ payload: [String: Any], for owner: NFCNDEFReaderSession?) {
    guard let owner = owner, owner === session else { return }
    let resolve = pendingResolve
    pendingResolve = nil
    session = nil
    resolve?(payload)
  }

  func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
    guard session === self.session else { return }
    let ns = error as NSError
    // User dismissed the system sheet (readerSessionInvalidationErrorUserCanceled = 200).
    if ns.code == 200 {
      completePending([
        "ok": false,
        "verified": false,
        "errorCode": "cancelled",
        "errorMessage": "Cancelled.",
      ], for: session)
      return
    }
    completePending([
      "ok": false,
      "verified": false,
      "errorCode": "session",
      "errorMessage": error.localizedDescription,
    ], for: session)
  }

  func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {
    guard session === self.session, mode == "read" else { return }
    let message = messages.first
    completePending([
      "ok": true,
      "tag": [
        "ndefSupported": true,
        "message": encodeMessage(message),
        "usedBytes": message.map { estimateBytes($0) } ?? 0,
      ],
    ], for: session)
  }

  func readerSession(_ session: NFCNDEFReaderSession, didDetect tags: [NFCNDEFTag]) {
    guard session === self.session, let tag = tags.first else { return }
    session.connect(to: tag) { [weak self] error in
      guard let self = self, session === self.session else { return }
      if let error = error {
        self.completePending(["ok": false, "errorCode": "connect", "errorMessage": error.localizedDescription], for: session)
        session.invalidate()
        return
      }
      tag.queryNDEFStatus { status, capacity, error in
        guard session === self.session else { return }
        if let error = error {
          self.completePending(["ok": false, "errorCode": "status", "errorMessage": error.localizedDescription], for: session)
          session.invalidate()
          return
        }
        if self.mode == "read" {
          tag.readNDEF { message, error in
            guard session === self.session else { return }
            if let error = error {
              self.completePending(["ok": false, "errorCode": "read_failed", "errorMessage": error.localizedDescription], for: session)
            } else {
              self.completePending([
                "ok": true,
                "tag": [
                  "ndefSupported": true,
                  "writable": status == .readWrite,
                  "readOnly": status == .readOnly,
                  "capacityBytes": capacity,
                  "usedBytes": message.map { self.estimateBytes($0) } ?? 0,
                  "message": self.encodeMessage(message),
                ],
              ], for: session)
            }
            session.invalidate()
          }
          return
        }
        if self.mode == "write" {
          self.completePending([
            "ok": false,
            "verified": false,
            "errorCode": "integration_pending",
            "errorMessage": "iOS NFC writing is not enabled yet.",
          ], for: session)
          session.invalidate()
          return
        }
        if self.mode == "lock" {
          tag.writeLock { error in
            guard session === self.session else { return }
            if let error = error {
              self.completePending(["ok": false, "errorCode": "lock_failed", "errorMessage": error.localizedDescription], for: session)
            } else {
              self.completePending(["ok": true], for: session)
            }
            session.invalidate()
          }
        }
      }
    }
  }

  private func estimateBytes(_ message: NFCNDEFMessage) -> Int {
    message.records.reduce(0) { $0 + ($1.payload.count) + 8 }
  }

  private func encodeMessage(_ message: NFCNDEFMessage?) -> [String: Any] {
    guard let message = message else {
      return ["records": [], "byteLength": 0]
    }
    let records: [[String: Any]] = message.records.map { record in
      let typeName = String(data: record.type, encoding: .utf8) ?? ""
      let payload = record.payload
      if record.typeNameFormat == .nfcWellKnown && typeName == "U" {
        let value = decodeUri(payload)
        let classified = classifyUri(value)
        return [
          "type": classified,
          "label": classified == "tel" ? "Telephone" : classified == "mailto" ? "Email" : classified == "sms" ? "SMS" : "URI",
          "value": value,
        ]
      }
      if record.typeNameFormat == .nfcWellKnown && typeName == "T" {
        let parsed = decodeText(payload)
        return [
          "type": "text",
          "label": "Plain text",
          "value": parsed.text,
          "language": parsed.language,
        ]
      }
      if record.typeNameFormat == .media {
        let mime = typeName
        let value = String(data: payload, encoding: .utf8) ?? ""
        let isVcard = mime.range(of: "vcard", options: .caseInsensitive) != nil
        return [
          "type": isVcard ? "vcard" : "mime",
          "label": isVcard ? "Contact (vCard)" : "MIME (\(mime))",
          "value": value,
          "mimeType": mime,
        ]
      }
      return [
        "type": "unknown",
        "label": "TNF \(record.typeNameFormat.rawValue) / \(typeName)",
        "value": String(data: payload.prefix(500), encoding: .utf8) ?? "",
      ]
    }
    return ["records": records, "byteLength": estimateBytes(message)]
  }

  private func classifyUri(_ value: String) -> String {
    if value.hasPrefix("tel:") { return "tel" }
    if value.hasPrefix("mailto:") { return "mailto" }
    if value.hasPrefix("sms:") { return "sms" }
    return "uri"
  }

  private func decodeUri(_ payload: Data) -> String {
    guard !payload.isEmpty else { return "" }
    let prefixes = [
      "", "http://www.", "https://www.", "http://", "https://", "tel:", "mailto:",
      "ftp://anonymous:anonymous@", "ftp://ftp.", "ftps://", "sftp://", "smb://", "nfs://", "ftp://",
      "dav://", "news:", "telnet://", "imap:", "rtsp://", "urn:", "pop:", "sip:", "sips:", "tftp:",
      "btspp://", "btl2cap://", "btgoep://", "tcpobex://", "irdaobex://", "file://",
      "urn:epc:id:", "urn:epc:tag:", "urn:epc:pat:", "urn:epc:raw:", "urn:epc:", "urn:nfc:",
    ]
    let code = Int(payload[payload.startIndex])
    let rest = String(data: payload.dropFirst(), encoding: .utf8) ?? ""
    let prefix = code < prefixes.count ? prefixes[code] : ""
    return prefix + rest
  }

  private func decodeText(_ payload: Data) -> (text: String, language: String) {
    guard !payload.isEmpty else { return ("", "en") }
    let status = payload[payload.startIndex]
    let utf16 = (status & 0x80) != 0
    let langLen = Int(status & 0x3f)
    let langData = payload.dropFirst().prefix(langLen)
    let language = String(data: langData, encoding: .utf8) ?? "en"
    let textData = payload.dropFirst(1 + langLen)
    if utf16 {
      return (String(data: Data(textData), encoding: .utf16) ?? "", language)
    }
    return (String(data: Data(textData), encoding: .utf8) ?? "", language)
  }
}
