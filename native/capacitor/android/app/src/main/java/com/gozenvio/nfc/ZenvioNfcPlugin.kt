package com.gozenvio.nfc

import android.app.Activity
import android.nfc.NdefMessage
import android.nfc.NdefRecord
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.Ndef
import android.os.Handler
import android.os.Looper
import android.util.Base64
import java.nio.charset.Charset
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

/**
 * Android NFC plugin for Zenvio NFC Studio.
 * Requires android.permission.NFC and a physical NFC device.
 * All tag I/O runs off the main thread.
 * Writes expect a complete NDEF message already serialized by the web layer (base64 → bytes).
 */
class ZenvioNfcPlugin(private val activity: Activity) {
  private val adapter: NfcAdapter? = NfcAdapter.getDefaultAdapter(activity)
  private val io = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())
  private val pending = AtomicReference<PendingOp?>(null)
  private val tokenSeq = java.util.concurrent.atomic.AtomicLong(0)

  private data class PendingOp(
    val token: Long,
    val callback: (Map<String, Any?>) -> Unit,
    @Volatile var cancelled: Boolean = false,
  )

  fun getCapabilities(callback: (Map<String, Any?>) -> Unit) {
    val a = adapter
    val result = when {
      a == null -> mapOf(
        "state" to "unsupported",
        "platform" to "android-native",
        "canRead" to false,
        "canWrite" to false,
        "canMakeReadOnly" to false,
        "canFormat" to false,
        "detail" to "This device has no NFC adapter.",
      )
      !a.isEnabled -> mapOf(
        "state" to "nfc_disabled",
        "platform" to "android-native",
        "canRead" to false,
        "canWrite" to false,
        "canMakeReadOnly" to false,
        "canFormat" to false,
        "detail" to "NFC is turned off. Enable it in system settings.",
      )
      else -> mapOf(
        "state" to "ready",
        "platform" to "android-native",
        "canRead" to true,
        "canWrite" to true,
        "canMakeReadOnly" to true,
        "canFormat" to false,
        "detail" to "Android NFC reader mode is available.",
      )
    }
    main.post { callback(result) }
  }

  fun startReading(callback: (Map<String, Any?>) -> Unit) {
    val op = armPending(callback) ?: return
    enableReaderMode(op) { tag ->
      io.execute {
        if (!isActive(op)) {
          completePending(op.token, cancelledMap())
          return@execute
        }
        completePending(op.token, readTag(tag))
      }
    }
  }

  fun writeNdef(ndefBase64: String, overwriteConfirmed: Boolean, callback: (Map<String, Any?>) -> Unit) {
    if (!overwriteConfirmed) {
      callback(
        mapOf(
          "ok" to false,
          "verified" to false,
          "errorCode" to "confirm_overwrite",
          "errorMessage" to "Confirm overwrite before writing.",
        ),
      )
      return
    }
    val bytes = try {
      Base64.decode(ndefBase64, Base64.DEFAULT)
    } catch (_: Exception) {
      callback(
        mapOf(
          "ok" to false,
          "verified" to false,
          "errorCode" to "invalid_payload",
          "errorMessage" to "Invalid NDEF payload.",
        ),
      )
      return
    }
    val op = armPending(callback) ?: return
    enableReaderMode(op) { tag ->
      io.execute {
        if (!isActive(op)) {
          completePending(op.token, cancelledMap(withVerified = true))
          return@execute
        }
        val write = writeTag(tag, bytes)
        if (write["ok"] != true) {
          completePending(op.token, write)
          return@execute
        }
        if (!isActive(op)) {
          // Physical write already happened — report success without stealing a newer callback.
          completePending(op.token, write + mapOf("verified" to false))
          return@execute
        }
        val readBack = readTag(tag)
        val message = (readBack["tag"] as? Map<*, *>)?.get("message")
        val verified = write["payloadHash"] == readBack["payloadHash"]
        completePending(
          op.token,
          write + mapOf(
            "verified" to verified,
            "tag" to readBack["tag"],
            "readBack" to message,
            "errorCode" to if (verified) null else "verify_mismatch",
            "errorMessage" to if (verified) null else "Read-back did not match the written payload.",
          ),
        )
      }
    }
  }

  fun makeReadOnly(callback: (Map<String, Any?>) -> Unit) {
    val op = armPending(callback) ?: return
    enableReaderMode(op) { tag ->
      io.execute {
        if (!isActive(op)) {
          completePending(op.token, cancelledMap())
          return@execute
        }
        val ndef = Ndef.get(tag)
        val result = try {
          if (ndef == null) mapOf("ok" to false, "errorCode" to "unsupported", "errorMessage" to "Not an NDEF tag.")
          else {
            ndef.connect()
            if (!ndef.isWritable) mapOf("ok" to false, "errorCode" to "read_only", "errorMessage" to "Tag is already read-only.")
            else if (!ndef.makeReadOnly()) {
              mapOf("ok" to false, "errorCode" to "lock_failed", "errorMessage" to "Tag refused permanent lock.")
            } else {
              mapOf("ok" to true)
            }
          }
        } catch (e: Exception) {
          mapOf("ok" to false, "errorCode" to "lock_failed", "errorMessage" to (e.message ?: "Lock failed"))
        } finally {
          try { Ndef.get(tag)?.close() } catch (_: Exception) {}
        }
        completePending(op.token, result)
      }
    }
  }

  fun cancelOperation(callback: (Map<String, Any?>) -> Unit) {
    val current = pending.get()
    if (current != null) {
      current.cancelled = true
      adapter?.disableReaderMode(activity)
      completePending(current.token, cancelledMap(withVerified = true))
    } else {
      adapter?.disableReaderMode(activity)
    }
    callback(mapOf("ok" to true))
  }

  private fun armPending(callback: (Map<String, Any?>) -> Unit): PendingOp? {
    val op = PendingOp(token = tokenSeq.incrementAndGet(), callback = callback)
    if (!pending.compareAndSet(null, op)) {
      callback(mapOf("ok" to false, "errorCode" to "busy", "errorMessage" to "Another NFC operation is already in progress."))
      return null
    }
    return op
  }

  private fun isActive(op: PendingOp): Boolean {
    val current = pending.get()
    return current != null && current.token == op.token && !current.cancelled
  }

  private fun completePending(token: Long, result: Map<String, Any?>) {
    val current = pending.get() ?: return
    if (current.token != token) return
    if (!pending.compareAndSet(current, null)) return
    main.post { current.callback(result) }
  }

  private fun cancelledMap(withVerified: Boolean = false): Map<String, Any?> {
    val base = mutableMapOf<String, Any?>(
      "ok" to false,
      "errorCode" to "cancelled",
      "errorMessage" to "Cancelled.",
    )
    if (withVerified) base["verified"] = false
    return base
  }

  private fun enableReaderMode(op: PendingOp, onTag: (Tag) -> Unit) {
    val a = adapter
    if (a == null) {
      completePending(op.token, mapOf("ok" to false, "errorCode" to "unsupported", "errorMessage" to "This device has no NFC adapter."))
      return
    }
    a.enableReaderMode(
      activity,
      { tag ->
        if (!isActive(op)) {
          a.disableReaderMode(activity)
          completePending(op.token, cancelledMap(withVerified = true))
          return@enableReaderMode
        }
        a.disableReaderMode(activity)
        onTag(tag)
      },
      // Keep NDEF tech discovery enabled so Ndef.get(tag) works on compatible tags.
      NfcAdapter.FLAG_READER_NFC_A or
        NfcAdapter.FLAG_READER_NFC_B or
        NfcAdapter.FLAG_READER_NFC_F or
        NfcAdapter.FLAG_READER_NFC_V,
      null,
    )
  }

  private fun readTag(tag: Tag): Map<String, Any?> {
    val ndef = Ndef.get(tag)
    if (ndef == null) {
      return mapOf("ok" to false, "errorCode" to "non_ndef", "errorMessage" to "This tag does not expose NDEF.")
    }
    return try {
      ndef.connect()
      val msg = ndef.ndefMessage
      val encoded = encodeMessage(msg)
      mapOf(
        "ok" to true,
        "payloadHash" to (msg?.toByteArray()?.contentHashCode() ?: 0),
        "tag" to mapOf(
          "ndefSupported" to true,
          "writable" to ndef.isWritable,
          "readOnly" to !ndef.isWritable,
          "capacityBytes" to ndef.maxSize,
          "usedBytes" to (msg?.byteArrayLength ?: 0),
          "technology" to tag.techList.joinToString(","),
          "message" to encoded,
          "messageBase64" to if (msg != null) Base64.encodeToString(msg.toByteArray(), Base64.NO_WRAP) else null,
        ),
      )
    } catch (e: Exception) {
      mapOf("ok" to false, "errorCode" to "read_failed", "errorMessage" to (e.message ?: "Read failed"))
    } finally {
      try { ndef.close() } catch (_: Exception) {}
    }
  }

  private fun writeTag(tag: Tag, bytes: ByteArray): Map<String, Any?> {
    val ndef = Ndef.get(tag)
    if (ndef == null) {
      return mapOf("ok" to false, "verified" to false, "errorCode" to "non_ndef", "errorMessage" to "This tag does not expose NDEF.")
    }
    return try {
      ndef.connect()
      if (!ndef.isWritable) {
        return mapOf("ok" to false, "verified" to false, "errorCode" to "read_only", "errorMessage" to "Tag is not writable.")
      }
      if (bytes.size > ndef.maxSize) {
        return mapOf("ok" to false, "verified" to false, "errorCode" to "capacity", "errorMessage" to "Payload exceeds tag capacity.")
      }
      val message = NdefMessage(bytes)
      ndef.writeNdefMessage(message)
      mapOf(
        "ok" to true,
        "verified" to false,
        "payloadHash" to bytes.contentHashCode(),
        "writtenBytes" to bytes.size,
      )
    } catch (e: Exception) {
      mapOf("ok" to false, "verified" to false, "errorCode" to "write_failed", "errorMessage" to (e.message ?: "Write failed"))
    } finally {
      try { ndef.close() } catch (_: Exception) {}
    }
  }

  private fun encodeMessage(msg: NdefMessage?): Map<String, Any?> {
    if (msg == null) return mapOf("records" to emptyList<Any>(), "byteLength" to 0)
    val records = msg.records.map { encodeRecord(it) }
    return mapOf("records" to records, "byteLength" to msg.byteArrayLength)
  }

  private fun encodeRecord(record: NdefRecord): Map<String, Any?> {
    val type = String(record.type, Charsets.US_ASCII)
    val payload = record.payload
    return when (record.tnf) {
      NdefRecord.TNF_WELL_KNOWN -> when (type) {
        "U" -> {
          val value = decodeUri(payload)
          val classified = classifyUri(value)
          mapOf(
            "type" to classified,
            "label" to when (classified) {
              "tel" -> "Telephone"
              "mailto" -> "Email"
              "sms" -> "SMS"
              else -> "URI"
            },
            "value" to value,
          )
        }
        "T" -> {
          val parsed = decodeText(payload)
          mapOf(
            "type" to "text",
            "label" to "Plain text",
            "value" to parsed.first,
            "language" to parsed.second,
          )
        }
        else -> mapOf(
          "type" to "unknown",
          "label" to "Well-known /$type",
          "value" to String(payload.take(500).toByteArray(), Charsets.UTF_8),
        )
      }
      NdefRecord.TNF_MIME_MEDIA -> {
        val mime = type
        val value = String(payload, Charsets.UTF_8)
        val isVcard = mime.contains("vcard", ignoreCase = true)
        mapOf(
          "type" to if (isVcard) "vcard" else "mime",
          "label" to if (isVcard) "Contact (vCard)" else "MIME ($mime)",
          "value" to value,
          "mimeType" to mime,
        )
      }
      else -> mapOf(
        "type" to "unknown",
        "label" to "TNF ${record.tnf} /$type",
        "value" to String(payload.take(500).toByteArray(), Charsets.UTF_8),
      )
    }
  }

  private fun classifyUri(value: String): String = when {
    value.startsWith("tel:") -> "tel"
    value.startsWith("mailto:") -> "mailto"
    value.startsWith("sms:") -> "sms"
    else -> "uri"
  }

  private fun decodeUri(payload: ByteArray): String {
    if (payload.isEmpty()) return ""
    val prefixes = arrayOf(
      "", "http://www.", "https://www.", "http://", "https://", "tel:", "mailto:",
      "ftp://anonymous:anonymous@", "ftp://ftp.", "ftps://", "sftp://", "smb://", "nfs://", "ftp://",
      "dav://", "news:", "telnet://", "imap:", "rtsp://", "urn:", "pop:", "sip:", "sips:", "tftp:",
      "btspp://", "btl2cap://", "btgoep://", "tcpobex://", "irdaobex://", "file://",
      "urn:epc:id:", "urn:epc:tag:", "urn:epc:pat:", "urn:epc:raw:", "urn:epc:", "urn:nfc:",
    )
    val code = payload[0].toInt() and 0xff
    val rest = String(payload, 1, payload.size - 1, Charsets.UTF_8)
    val prefix = if (code < prefixes.size) prefixes[code] else ""
    return prefix + rest
  }

  private fun decodeText(payload: ByteArray): Pair<String, String> {
    if (payload.isEmpty()) return "" to "en"
    val status = payload[0].toInt() and 0xff
    val utf16 = status and 0x80 != 0
    val langLen = status and 0x3f
    val language = String(payload, 1, langLen, Charsets.US_ASCII).ifEmpty { "en" }
    val textBytes = payload.copyOfRange(1 + langLen, payload.size)
    val text = if (utf16) decodeUtf16Ndef(textBytes) else String(textBytes, Charsets.UTF_8)
    return text to language
  }

  private fun decodeUtf16Ndef(textBytes: ByteArray): String {
    var offset = 0
    var charset = Charset.forName("UTF-16BE")
    if (textBytes.size >= 2) {
      val b0 = textBytes[0].toInt() and 0xff
      val b1 = textBytes[1].toInt() and 0xff
      if (b0 == 0xfe && b1 == 0xff) {
        charset = Charset.forName("UTF-16BE")
        offset = 2
      } else if (b0 == 0xff && b1 == 0xfe) {
        charset = Charset.forName("UTF-16LE")
        offset = 2
      }
    }
    return String(textBytes, offset, textBytes.size - offset, charset)
  }
}
