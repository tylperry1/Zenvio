import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const team = fs.readFileSync("src/app/api/admin/team/route.ts", "utf8");
const migration = fs.readFileSync("postgres/migrations/039_staff_access.sql", "utf8");
const sections = fs.readFileSync("src/lib/admin-sections.ts", "utf8");

test("team management is reserved to the master admin", () => {
  // No permission argument means employees can never manage the team.
  assert.equal((team.match(/await adminSession\(\)/g) || []).length, 2);
  assert.doesNotMatch(sections, /^\s*team:/m);
  assert.match(team, /sameOrigin\(request\)/);
  assert.match(team, /private\.admin_audit_log/);
});

test("inviting an employee never touches the master admin's session", () => {
  assert.doesNotMatch(team, /signUpEmail|signInEmail/);
  assert.match(team, /requestPasswordReset\(\{\s*body:/);
  assert.doesNotMatch(team, /requestPasswordReset\(\{[^}]*headers/);
});

test("employees only gain admin SQL privileges inside an authorized scope", () => {
  assert.match(migration, /current_setting\('zenvio\.admin_scope', true\) = any\(s\.permissions\)/);
  assert.match(migration, /s\.enabled and u\."emailVerified"/);
  assert.match(migration, /revoke all on private\.staff_members from public, anon, authenticated/);
});

test("master admin always has full product features", () => {
  assert.match(migration, /select 'team' from private\.platform_roles where user_id=target and enabled/);
});
