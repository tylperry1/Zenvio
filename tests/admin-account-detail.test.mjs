import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("admin account detail migration exposes platform role", () => {
  const sql = fs.readFileSync("postgres/migrations/081_admin_account_detail_role.sql", "utf8");
  assert.match(sql, /admin_account_detail/);
  assert.match(sql, /platform_roles/);
  assert.match(sql, /'role'/);
  assert.match(sql, /master_admin/);
  assert.match(sql, /industry/);
});

test("admin account modal shows role and joined date", () => {
  const ui = fs.readFileSync("src/components/admin-center.tsx", "utf8");
  assert.match(ui, /Platform role/);
  assert.match(ui, /detail\.role === "master_admin"/);
  assert.match(ui, /Joined/);
  assert.match(ui, /detail\.created_at/);
});

test("admin user actions keep master-admin protect and styled notices", () => {
  const actions = fs.readFileSync("src/components/admin-user-actions.tsx", "utf8");
  assert.match(actions, /account\.role === "master_admin"/);
  assert.match(actions, /notice error/);
});
