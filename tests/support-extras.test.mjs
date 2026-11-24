import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const read = (f) => fs.readFileSync(f, "utf8");
const lib = read("src/lib/support.ts");
const migration = read("postgres/migrations/067_support_center_extras.sql");

test("support extras migration is additive and private", () => {
  assert.doesNotMatch(migration, /drop table|drop column|alter column/i);
  assert.match(migration, /add column if not exists category/);
  assert.match(migration, /add column if not exists priority/);
  assert.match(migration, /rating is null or rating between 1 and 5/);
  assert.match(migration, /revoke all on private\.support_agents from public, anon, authenticated/);
});

test("employee-only fields never reach customers", () => {
  assert.match(lib, /\$\{staff \? "coalesce\(u\.email,t\.visitor_email\) email,a\.name assignee_name,\(t\.user_id IS NULL\) visitor/);
  assert.match(lib, /\$\{staff \? ',t\.page,t\.user_id,coalesce\(u\.name,t\.visitor_name\) customer_name,coalesce\(u\.email,t\.visitor_email\) customer_email/);
  assert.match(lib, /if \(staff\) \{\s*const meta = ticketRow/);
  // Search by name or email is staff-only.
  assert.match(lib, /OR \(\$1 AND \(strpos\(lower\(coalesce\(u\.email,t\.visitor_email\)\)/);
});

test("staff-only actions are gated and priority/rating are validated", () => {
  for (const action of ["delete-reply", "availability", "suggestion"]) assert.match(lib, new RegExp(`staff && input\\.action === "${action}"`));
  assert.match(lib, /if \(staff && input\.priority !== undefined\)/);
  assert.match(lib, /supportPriorities as readonly string\[\]\)\.includes/);
  assert.match(lib, /!staff && input\.action === "rate"/);
  assert.match(lib, /ticket\.status !== "resolved"/);
  // Only a customer's own written message can become a suggestion.
  assert.match(lib, /WHERE m\.id=\$1 AND NOT m\.staff AND NOT EXISTS \(SELECT 1 FROM private\.support_attachments/);
});

test("staff reply status hand-off accepts pending alias or resolved and keeps internal notes neutral", () => {
  assert.match(lib, /normalizeSupportStatus\(input\.status\)/);
  assert.match(lib, /input\.status === "pending"/);
  assert.match(lib, /keepOpen/);
  assert.match(lib, /status=CASE WHEN \$2 THEN status/);
  assert.match(lib, /first_response_at=CASE WHEN \$3 AND NOT \$2/);
});

test("support navigation groups the desk and suggestions in one area", () => {
  const nav = read("src/lib/admin-console-nav.ts");
  assert.match(
    nav,
    /label: "Support"[\s\S]*?id: "support-ops"[\s\S]*?permission: "support"[\s\S]*?id: "feedback"[\s\S]*?permission: "feedback"/,
  );
  // The classic inbox is a view of the same area, not a second console entry.
  assert.doesNotMatch(nav, /id: "support",\n/);
});
