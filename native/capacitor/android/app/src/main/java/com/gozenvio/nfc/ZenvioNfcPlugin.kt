package com.gozenvio.nfc

import android.app.Activity
import android.nfc.NdefMessage
import android.nfc.NdefRecord
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.Ndef
import android.os.Handler
import android.os.Looper
import java.util.concurrent.Executors

/**
 * Android NFC plugin for Zenvio NFC Studio.
 * Requires android.permission.NFC and a physical NFC device.
 * All tag I/O runs off the main thread.
 */
class ZenvioNfcPlugin(private val activity: Activity) {
  private val adapter: NfcAdapter? = NfcAdapter.getDefaultAdapter(activity)
  private val io = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())
  @Volatile private var cancelled = false

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
    cancelled = false
    enableReaderMode { tag ->
      io.execute {
        val result = readTag(tag)
        main.post { callback(result) }
      }
    }
  }

  fun writeNdef(bytes: ByteArray, overwriteConfirmed: Boolean, callback: (Map<String, Any?>) -> Unit) {
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
    cancelled = false
    enableReaderMode { tag ->
      io.execute {
        val write = writeTag(tag, bytes)
        if (write["ok"] != true) {
          main.post { callback(write) }
          return@execute
        }
        val readBack = readTag(tag)
        val verified = write["payloadHash"] == readBack["payloadHash"]
        main.post {
          callback(
            write + mapOf(
              "verified" to verified,
              "readBack" to readBack["tag"],
              "errorCode" to if (verified) null else "verify_mismatch",
              "errorMessage" to if (verified) null else "Read-back did not match the written payload.",
            ),
          )
        }
      }
    }
  }

  fun makeReadOnly(callback: (Map<String, Any?>) -> Unit) {
    cancelled = false
    enableReaderMode { tag ->
      io.execute {
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
        main.post { callback(result) }
      }
    }
  }

  fun cancelOperation(callback: (Map<String, Any?>) -> Unit) {
    cancelled = true
    adapter?.disableReaderMode(activity)
    callback(mapOf("ok" to true))
  }

  private fun enableReaderMode(onTag: (Tag) -> Unit) {
    val a = adapter ?: return
    a.enableReaderMode(
      activity,
      { tag ->
        if (cancelled) return@enableReaderMode
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
      // Expect a single well-formed NDEF message byte array from the web serializer.
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
}
