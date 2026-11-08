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
class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const options = load("src/lib/support-options.ts");
const S = load("src/lib/support.ts", {
  "./db": { getPool: () => ({}) },
  "./server": { ApiError, string: (v) => v, uuid: (v) => v },
  "./platform-settings": { integrationValue: async () => "" },
  "./resend-diagnostics": { resendFailure: () => new Error("x") },
  "./support-options": options,
});
const read = (f) => fs.readFileSync(f, "utf8");

test("support reply emails escape customer and staff text", () => {
  const m = S.composeSupportEmail({ customerName: "Ana <b>Ruiz</b>", subject: "Card <script>", agent: "Sam", body: "Try <img src=x onerror=alert(1)>", url: "https://gozenvio.com/app/support?conversation=1" });
  assert.equal(m.subject, "Re: Card <script>");
  assert.match(m.text, /^Hi Ana,/);
  assert.match(m.text, /Sam from Zenvio support replied/);
  assert.doesNotMatch(m.html, /<script>|<img|<b>Ruiz/);
  assert.match(m.html, /Card &lt;script&gt;/);
});

test("enumerated inputs are validated", () => {
  assert.equal(S.oneOf("resolved", options.supportStatuses, "status"), "resolved");
  assert.throws(() => S.oneOf("closed", options.supportStatuses, "status"), /valid status/);
  assert.throws(() => S.oneOf("critical", options.supportPriorities, "priority"), /valid priority/);
  assert.equal(options.supportCategoryLabel("billing"), "Billing & plans");
});

test("customers only ever see their own conversations and never internal notes", () => {
  const lib = read("src/lib/support.ts");
  const thread = lib.slice(lib.indexOf("export async function customerThread"), lib.indexOf("export async function startConversation"));
  assert.match(thread, /WHERE id=\$1 AND user_id=\$2/);
  assert.match(thread, /NOT m\.internal/);
  assert.doesNotMatch(thread, /u\.email/);
  const list = lib.slice(lib.indexOf("export async function customerConversations"), lib.indexOf("export async function customerThread"));
  assert.match(list, /WHERE c\.user_id=\$1/);
  assert.match(list, /NOT m\.internal/);
  for (const fn of ["customerReply", "customerUpdate"]) {
    const body = lib.slice(lib.indexOf(`export async function ${fn}`));
    assert.match(body.slice(0, 1200), /user_id=\$2/);
  }
  const migration = read("postgres/migrations/066_support_center.sql");
  assert.match(migration, /check \(not internal or author_role = 'staff'\)/);
  assert.match(migration, /revoke all on private\.support_conversations/);
});

test("employee routes require the support permission and are rate limited for customers", () => {
  const admin = read("src/app/api/admin/support/route.ts");
  assert.equal((admin.match(/adminSession\("support"\)/g) || []).length, 2);
  assert.match(admin, /sameOrigin\(request\)/);
  const customer = read("src/app/api/support/route.ts");
  assert.match(customer, /sameOrigin\(request\)/);
  assert.match(customer, /allowRequest\("support-message"/);
  assert.match(customer, /allowRequest\("support-start"/);
  assert.match(read("src/app/admin/support/page.tsx"), /requirePageSession\("support"\)/);
  assert.match(read("src/lib/admin-sections.ts"), /support: "\/admin\/support"/);
});

test("reply emails are sent once, only for unread public staff replies", () => {
  const lib = read("src/lib/support.ts");
  const deliver = lib.slice(lib.indexOf("export async function deliverSupportEmails"));
  assert.match(deliver, /author_role='staff' AND NOT m\.internal AND m\.notified_at IS NULL/);
  assert.match(deliver, /m\.created_at > coalesce\(c\.customer_read_at/);
  assert.match(deliver, /"Idempotency-Key": `support-\$\{m\.id\}`/);
  assert.match(deliver, /SET notified_at=now\(\) WHERE id=\$1 AND notified_at IS NULL/);
});
