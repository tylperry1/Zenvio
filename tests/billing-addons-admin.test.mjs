import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";

class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function load(file, mocks = {}) {
  const filename = path.resolve(file);
  const m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = m.require.bind(m);
  m.require = (id) => (Object.hasOwn(mocks, id) ? mocks[id] : normal(id));
  m._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  );
  return m.exports;
}

const addons = load("src/lib/billing-addons.ts", {
  "./server": {
    ApiError,
    string: (v, label, max = 200, min = 1) => {
      const s = String(v ?? "");
      if (s.length < min || s.length > max) throw new ApiError(label || "invalid");
      return s;
    },
    integer: (v, label, min, max) => {
      if (!Number.isInteger(v) || v < min || v > max) throw new ApiError(label || "invalid");
      return v;
    },
  },
});

test("addon update parser accepts name/amount/available and rejects empty patches", () => {
  const parsed = addons.parseAddonUpdate({
    addonId: "ai_100",
    name: "100 AI credits",
    amountCents: 299,
    available: false,
  });
  assert.equal(parsed.id, "ai_100");
  assert.equal(parsed.amountCents, 299);
  assert.equal(parsed.available, false);
  assert.throws(() => addons.parseAddonUpdate({ addonId: "ai_100" }), /field/i);
  assert.throws(() => addons.parseAddonUpdate({ addonId: "BAD!" }), /valid/i);
});

test("migration 094 seeds the approved add-on catalog behind available=false", () => {
  const sql = fs.readFileSync("postgres/migrations/094_billing_addons.sql", "utf8");
  for (const id of [
    "ai_100",
    "ai_500",
    "envelopes_10",
    "envelope_1",
    "video_1000",
    "storage_10gb",
    "sms_starter",
    "sms_segment",
    "business_extra",
  ]) {
    assert.match(sql, new RegExp(`'${id}'`));
  }
  assert.match(sql, /available boolean NOT NULL DEFAULT false/);
  assert.match(sql, /stripe_price_id/);
});

test("admin billing center exposes an Add-ons section", () => {
  const ui = fs.readFileSync("src/components/admin-billing-center.tsx", "utf8");
  assert.match(ui, /\["addons", "Add-ons"\]/);
  assert.match(ui, /action: "addon-sync-all"/);
  assert.match(ui, /action: "addon-update"/);
  assert.match(ui, /ADDON_BILLING_VALIDATED/);
  assert.match(ui, /if \(!result\) return/);
});

test("provision script locks add-ons and refuses unreadable live price overwrite", () => {
  const script = fs.readFileSync("scripts/provision-pricing-v4.mjs", "utf8");
  assert.match(script, /FROM private\.billing_addons ORDER BY id FOR UPDATE/);
  assert.match(script, /Refusing to overwrite/);
  assert.match(script, /resource_missing/);
  const docs = fs.readFileSync("docs/PRICING_V4_ACTIVATION.md", "utf8");
  assert.match(docs, /disposable test database/);
  assert.match(docs, /no live v4/);
});
