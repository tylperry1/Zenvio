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
class ApiError extends Error { constructor(m, s = 400) { super(m); this.status = s; } }
const S = load("src/lib/smart-cards.ts", { "./server": { ApiError } });
const base = { id: "1", user_id: "u", slug: "jane-doe", display_name: "Jane Doe", company: "Acme, Inc.", job_title: "Owner", bio: "Line one\nLine two; ok", phone: "+1 555 0100", email: "jane@example.test", website: "https://acme.example", address: "1 Main St", links: [], show_booking: true, show_phone: false, show_email: true, show_address: false, accent: "#365cff", published: true };

test("profile addresses are validated and reserved words blocked", () => {
  assert.equal(S.cleanSlug("  Jane-Doe "), "jane-doe");
  for (const bad of ["ab", "-jane", "jane_doe", "admin", "jane-", "x".repeat(51)]) assert.throws(() => S.cleanSlug(bad), ApiError, bad);
});

test("links must be https and are capped", () => {
  assert.deepEqual(S.cleanLinks([{ label: " IG ", url: "https://instagram.com/x" }]), [{ label: "IG", url: "https://instagram.com/x" }]);
  assert.throws(() => S.cleanLinks([{ label: "Bad", url: "javascript:alert(1)" }]));
  assert.throws(() => S.cleanLinks([{ label: "Plain", url: "http://example.com" }]));
  assert.throws(() => S.cleanLinks(Array.from({ length: 9 }, () => ({ label: "a", url: "https://a.co" }))));
  assert.throws(() => S.cleanWebsite("ftp://x"));
});

test("public view honours privacy settings and booking availability", () => {
  const v = S.publicView(base, "host-abc");
  assert.equal(v.phone, "");
  assert.equal(v.email, "jane@example.test");
  assert.equal(v.address, "");
  assert.equal(v.bookingUrl, "/book/host-abc?src=smart-card");
  assert.equal(S.publicView({ ...base, show_booking: false }, "host-abc").bookingUrl, "");
  assert.equal(S.publicView(base, null).bookingUrl, "");
  assert.ok(!("user_id" in v) && !("id" in v));
});

test("vCard escapes separators and only includes visible fields", () => {
  const card = S.vcard(S.publicView(base, null), "https://gozenvio.com");
  assert.match(card, /^BEGIN:VCARD\r\nVERSION:3\.0\r\n/);
  assert.match(card, /ORG:Acme\\, Inc\./);
  assert.ok(card.includes("NOTE:Line one" + "\\" + "nLine two" + "\\" + "; ok"));
  assert.doesNotMatch(card, /TEL/);
  assert.match(card, /URL;TYPE=Profile:https:\/\/gozenvio\.com\/p\/jane-doe/);
  assert.ok(card.endsWith("END:VCARD\r\n"));
});

test("card tokens are long, URL-safe and unique", () => {
  const tokens = new Set(Array.from({ length: 2000 }, () => S.newCardToken()));
  assert.equal(tokens.size, 2000);
  for (const t of tokens) assert.match(t, /^[A-Za-z0-9_-]{24}$/);
});

test("card redirect and profile routes keep tokens private and enforce status", () => {
  const redirect = fs.readFileSync("src/app/c/[token]/route.ts", "utf8");
  assert.match(redirect, /card\.status !== "active"/);
  assert.match(redirect, /!card\.published/);
  assert.match(redirect, /"Referrer-Policy": "no-referrer"/);
  const api = fs.readFileSync("src/app/api/smart-profiles/route.ts", "utf8");
  assert.match(api, /WHERE id=\$1 AND user_id=\$2/);
  assert.match(api, /sameOrigin\(request\)/);
});
