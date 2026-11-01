import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import test from "node:test";
import ts from "typescript";

function load(file, mocks = {}) {
  const filename = path.resolve(file);
  const m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = m.require.bind(m);
  m.require = (id) => mocks[id] ?? original(id);
  m._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
  return m.exports;
}
const M = load("src/lib/market-mail.ts", { "./db": { getPool: () => ({}) }, "./platform-settings": { integrationValue: async () => "", unsealSecret: (s) => s }, "./resend-diagnostics": { resendFailure: () => new Error("x") } });
const order = { id: "abcdef12-0000-4000-8000-000000000000", user_id: null, customer_name: "Ana <b>Ruiz</b>", total_cents: 4598, refunded_cents: 0, tracking_number: "1Z999", tracking_url: "https://track.example/1Z999", carrier: "UPS", guest_token_sealed: null, items: [{ title: "Tote <script>", quantity: 2, price_cents: 1999 }] };

test("order emails have clear subjects, totals and escaped HTML", () => {
  const c = M.composeMarketEmail("confirmation", order, "https://gozenvio.com/marketplace/order#tok");
  assert.equal(c.subject, "Order ABCDEF12 confirmed");
  assert.match(c.text, /\$45\.98 was received/);
  assert.match(c.text, /2 × Tote <script> — \$39\.98/);
  assert.doesNotMatch(c.html, /<script>|<b>Ruiz/);
  assert.match(c.html, /Tote &lt;script&gt;/);
  const s = M.composeMarketEmail("shipped", order, "https://x");
  assert.match(s.text, /Carrier: UPS\nTracking number: 1Z999\nTrack it: https:\/\/track\.example\/1Z999/);
  assert.match(M.composeMarketEmail("refunded", { ...order, refunded_cents: 1000 }, "https://x").text, /\$10\.00 has been issued/);
});

test("each order email kind is sent at most once", () => {
  const sql = fs.readFileSync("postgres/migrations/058_marketplace_guest_checkout_emails.sql", "utf8");
  assert.match(sql, /unique \(order_id, kind\)/);
  const lib = fs.readFileSync("src/lib/market-mail.ts", "utf8");
  assert.match(lib, /ON CONFLICT \(order_id,kind\) DO NOTHING/);
  assert.match(lib, /"Idempotency-Key": `market-\$\{job\.order_id\}-\$\{job\.kind\}`/);
  assert.match(lib, /SET attempts=attempts\+1 WHERE id=\$1 AND sent_at IS NULL AND attempts<5/);
});

test("guest orders are private, hashed and never expose admin fields", () => {
  const lib = fs.readFileSync("src/lib/marketplace.ts", "utf8");
  const fn = lib.slice(lib.indexOf("export async function guestOrderDetail"));
  assert.match(fn, /guest_token_hash=\$1 AND user_id IS NULL/);
  for (const secret of ["private_notes", "cost_cents", "supplier_id", "guest_token", "artwork_id"]) assert.ok(!fn.split("guest_token_hash=$1")[1].includes(secret), secret);
  assert.match(lib, /if \(guest && raw\?\.artwork_id\)/);
  assert.match(lib, /\(order\.user_id \?\? null\) !== \(session\.metadata\?\.user_id \|\| null\)/);
  assert.match(lib, /order\.user_id === null && session\.metadata\?\.guest !== "1"/);
  const route = fs.readFileSync("src/app/api/marketplace/route.ts", "utf8");
  assert.match(route, /allowRequest\("market-guest-checkout"/);
  assert.match(route, /allowRequest\("market-guest-email"/);
  const sql = fs.readFileSync("postgres/migrations/058_marketplace_guest_checkout_emails.sql", "utf8");
  assert.match(sql, /check \(user_id is not null or guest_token_hash is not null\)/);
});
