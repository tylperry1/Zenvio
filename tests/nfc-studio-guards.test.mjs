import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (p) => fs.readFileSync(p, "utf8");

test("NFC Studio route, APIs, migration, and native stubs exist", () => {
  for (const p of [
    "src/app/app/smart-cards/nfc-studio/page.tsx",
    "src/components/nfc-studio.tsx",
    "src/lib/nfc/adapter.ts",
    "src/lib/nfc/ndef.ts",
    "src/lib/nfc/web-nfc.ts",
    "src/app/api/nfc/overview/route.ts",
    "src/app/api/nfc/tags/route.ts",
    "src/app/api/nfc/operations/route.ts",
    "src/app/api/nfc/batches/route.ts",
    "src/app/api/admin/nfc/route.ts",
    "src/app/admin/nfc/page.tsx",
    "postgres/migrations/103_nfc_studio.sql",
    "native/capacitor/README.md",
    "native/capacitor/ios/App/App/Plugins/ZenvioNfcPlugin.swift",
    "native/capacitor/android/app/src/main/java/com/gozenvio/nfc/ZenvioNfcPlugin.kt",
  ]) {
    assert.ok(fs.existsSync(p), `missing ${p}`);
  }
});

test("middleware gates /api/nfc behind smartCards feature", () => {
  assert.match(read("src/middleware.ts"), /\/api\/nfc/);
});

test("NFC Studio page and APIs enforce nfc_studio.enabled", () => {
  assert.match(read("src/lib/nfc-studio.ts"), /assertNfcStudioEnabled/);
  assert.match(read("src/app/app/smart-cards/nfc-studio/page.tsx"), /isNfcStudioEnabled/);
  for (const p of [
    "src/app/api/nfc/overview/route.ts",
    "src/app/api/nfc/tags/route.ts",
    "src/app/api/nfc/operations/route.ts",
    "src/app/api/nfc/batches/route.ts",
  ]) {
    assert.match(read(p), /assertNfcStudioEnabled/, p);
  }
});

test("batch recording binds destination and clears completed batches", () => {
  const src = read("src/components/nfc-studio.tsx");
  assert.match(src, /writeMatchesActiveBatch/);
  assert.match(src, /destinationsMatch/);
  assert.match(src, /setActiveBatch\(null\)/);
  assert.match(src, /status: "failed"/);
  assert.match(
    src,
    /className="ds-btn ghost"\s+disabled=\{busy\}\s+onClick=\{\(\) =>\s*\n\s*postJson\("\/api\/nfc\/batches", \{ action: "complete"/,
  );
  assert.match(read("src/app/api/nfc/batches/route.ts"), /nfc_tags WHERE id=\$1 AND user_id/);
  assert.match(read("src/app/api/nfc/batches/route.ts"), /nfc_operations WHERE id=\$1 AND user_id/);
});

test("NFC Studio enable lookup does not fail open and abort links are operation-local", () => {
  const helpers = read("src/lib/nfc-studio.ts");
  assert.doesNotMatch(helpers, /catch\s*\{\s*return true/);
  assert.match(helpers, /row\?\.value\?\.enabled !== false/);
  const web = read("src/lib/nfc/web-nfc.ts");
  assert.match(web, /linkExternalSignal/);
  assert.match(web, /signal\.aborted/);
  assert.match(web, /removeEventListener\("abort"/);
});

test("Web NFC cancel settles waiting read and Android NDEF discovery is intact", () => {
  const web = read("src/lib/nfc/web-nfc.ts");
  assert.match(web, /recordFromReadValue/);
  assert.match(web, /onAbort/);
  assert.match(web, /AbortError/);
  assert.match(web, /TextEncoder\(\)\.encode/);
  const kotlin = read("native/capacitor/android/app/src/main/java/com/gozenvio/nfc/ZenvioNfcPlugin.kt");
  assert.doesNotMatch(kotlin, /NfcAdapter\.FLAG_READER_SKIP_NDEF_CHECK/);
  assert.match(kotlin, /!ndef\.makeReadOnly\(\)/);
  assert.match(kotlin, /completePending\(op\.token|completePending\(current\.token|completePending\(token/);
  assert.match(kotlin, /PendingOp/);
  assert.match(kotlin, /isActive\(op\)/);
  assert.match(kotlin, /readerLock/);
  assert.match(kotlin, /Stale discovery must NOT disableReaderMode/);
  assert.match(kotlin, /"message"/);
  assert.match(read("src/lib/nfc/capacitor-bridge.ts"), /opGeneration|ownsOp|beginOp/);
  assert.match(read("src/lib/nfc/ndef.ts"), /utf-16be/);
  const swift = read("native/capacitor/ios/App/App/Plugins/ZenvioNfcPlugin.swift");
  assert.match(swift, /"canWrite": false/);
  assert.match(swift, /ns\.code == 200/);
  assert.match(swift, /session === self\.session/);
  assert.match(swift, /encodeMessage/);
  const bridge = read("src/lib/nfc/capacitor-bridge.ts");
  assert.match(bridge, /ndefBase64/);
  assert.match(bridge, /serializeNdef/);
  assert.match(read("native/capacitor/README.md"), /ndefBase64/);
});

test("Studio allows deactivated cards for first NFC write", () => {
  const src = read("src/components/nfc-studio.tsx");
  assert.match(src, /status === "deactivated"/);
  assert.match(src, /first write/i);
});

test("Studio UI refuses actions without capability-ready state", () => {
  const src = read("src/components/nfc-studio.tsx");
  assert.match(src, /caps\?\.canRead/);
  assert.match(src, /caps\?\.canWrite/);
  assert.match(src, /iPhone Safari cannot use Core NFC/);
  assert.match(src, /overwriteOk/);
  assert.match(src, /lockAck/);
  assert.match(src, /read-after-write/i);
});

test("migration creates owner-scoped NFC tables", () => {
  const sql = read("postgres/migrations/103_nfc_studio.sql");
  assert.match(sql, /create table if not exists private\.nfc_tags/);
  assert.match(sql, /create table if not exists private\.nfc_operations/);
  assert.match(sql, /create table if not exists private\.nfc_batches/);
  assert.match(sql, /create table if not exists private\.nfc_batch_items/);
  assert.match(sql, /user_id uuid not null/);
});

test("admin console links NFC Studio", () => {
  assert.match(read("src/lib/admin-console-nav.ts"), /\/admin\/nfc/);
  assert.match(read("src/components/smart-cards.tsx"), /\/app\/smart-cards\/nfc-studio/);
});
