import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  adminNavGroups,
  resolveAdminNavId,
} from "../src/lib/admin-console-nav.ts";

const src = fs.readFileSync("src/lib/admin-console-nav.ts", "utf8");
const nav = fs.readFileSync("src/components/admin-navigation.tsx", "utf8");

test("admin console IA includes the nine primary groups", () => {
  for (const label of [
    "Command Center",
    "Users & Businesses",
    "Billing & Revenue",
    "Platform & Modules",
    "Communications",
    "Integrations & Services",
    "Costs & Analytics",
    "Security & Compliance",
    "System Settings",
  ]) {
    assert.match(src, new RegExp(`label: "${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  }
  assert.equal(
    adminNavGroups.find((g) => g.items.some((i) => i.id === "health"))?.label,
    "System Settings",
  );
});

test("nav resolves active items from the URL and keeps FI + economics reachable", () => {
  assert.match(nav, /resolveAdminNavId/);
  assert.match(nav, /adminNavGroups/);
  assert.match(src, /id: "financial-intelligence"/);
  assert.match(src, /href: "\/admin\/economics"/);
  assert.match(src, /href: "\/admin\/financial-intelligence"/);
  assert.match(src, /\/admin\/operations\?section=users/);
  assert.match(src, /path === "\/admin\/billing"/);
  assert.match(src, /path === "\/admin\/launch"/);
  assert.match(src, /return "billing-center"/);
  assert.match(src, /return "launch"/);

  const q = (search) => new URLSearchParams(search);
  assert.equal(resolveAdminNavId("/admin", q("")), "overview");
  assert.equal(resolveAdminNavId("/admin/", q("")), "overview");
  assert.equal(resolveAdminNavId("/admin", q("view=accounts")), "accounts");
  assert.equal(resolveAdminNavId("/admin", q("view=audit")), "audit");
  assert.equal(resolveAdminNavId("/admin/billing", q("")), "billing-center");
  assert.equal(resolveAdminNavId("/admin/financial-intelligence", q("")), "financial-intelligence");
  assert.equal(resolveAdminNavId("/admin/economics", q("")), "economics");
  assert.equal(resolveAdminNavId("/admin/launch", q("")), "launch");
  assert.equal(resolveAdminNavId("/admin/suppliers", q("")), "suppliers");
  assert.equal(resolveAdminNavId("/admin/gelato", q("")), "suppliers");
  assert.equal(resolveAdminNavId("/admin/operations", q("section=users")), "users");
  assert.equal(resolveAdminNavId("/admin/operations", q("section=health")), "health");
  assert.equal(resolveAdminNavId("/admin/operations", q("section=pricing")), "pricing");
  assert.equal(resolveAdminNavId("/admin/operations", q("")), "subscriptions");
  assert.equal(resolveAdminNavId("/admin/operations", q("section=unknown")), "subscriptions");
  assert.equal(resolveAdminNavId("/admin/not-a-real-page", q("")), "overview");
});

test("AdminFrame view mismatches for billing and launch are corrected", () => {
  const billing = fs.readFileSync("src/app/admin/billing/layout.tsx", "utf8");
  const launch = fs.readFileSync("src/app/admin/launch/layout.tsx", "utf8");
  const economics = fs.readFileSync("src/app/admin/economics/layout.tsx", "utf8");
  assert.match(billing, /view="billing-center"/);
  assert.match(launch, /view="launch"/);
  assert.match(economics, /view="economics"/);
});
