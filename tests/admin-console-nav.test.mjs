import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

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
});

test("AdminFrame view mismatches for billing and launch are corrected", () => {
  const billing = fs.readFileSync("src/app/admin/billing/layout.tsx", "utf8");
  const launch = fs.readFileSync("src/app/admin/launch/layout.tsx", "utf8");
  const economics = fs.readFileSync("src/app/admin/economics/layout.tsx", "utf8");
  assert.match(billing, /view="billing-center"/);
  assert.match(launch, /view="launch"/);
  assert.match(economics, /view="economics"/);
});
