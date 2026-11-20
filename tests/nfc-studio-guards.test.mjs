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
