import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  adminNavGroups,
  allAdminNavItems,
  resolveAdminNavId,
} from "../src/lib/admin-console-nav.ts";

const src = fs.readFileSync("src/lib/admin-console-nav.ts", "utf8");
const nav = fs.readFileSync("src/components/admin-navigation.tsx", "utf8");

test("admin console IA groups every area into six coherent sections", () => {
  assert.deepEqual(
    adminNavGroups.map((g) => g.label),
    ["Overview", "Customers", "Revenue", "Commerce", "Support", "Platform"],
  );
  assert.equal(
    adminNavGroups.find((g) => g.items.some((i) => i.id === "health"))?.label,
    "Platform",
  );
  for (const group of adminNavGroups) {
    assert.ok(group.description.length > 0, `${group.label} needs a description`);
  }
});

test("every console destination appears once and support has one entry", () => {
  const items = allAdminNavItems();
  const hrefs = items.map((i) => i.href);
  assert.equal(new Set(hrefs).size, hrefs.length);
  for (const item of items) {
    assert.ok(item.note.length > 0, `${item.label} needs a short description`);
  }
  const support = items.filter((i) => i.permission === "support");
  assert.deepEqual(support.map((i) => i.id), ["support-ops"]);
  assert.deepEqual(support.map((i) => i.href), ["/admin/support-ops"]);
});

test("nav resolves active items from the URL", () => {
  assert.match(nav, /resolveAdminNavId/);
  assert.match(nav, /adminNavGroups/);
  assert.match(src, /id: "financial-intelligence"/);
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
  assert.equal(resolveAdminNavId("/admin/launch", q("")), "launch");
  assert.equal(resolveAdminNavId("/admin/suppliers", q("")), "suppliers");
  assert.equal(resolveAdminNavId("/admin/gelato", q("")), "suppliers");
  assert.equal(resolveAdminNavId("/admin/operations", q("section=users")), "users");
  assert.equal(resolveAdminNavId("/admin/operations", q("section=health")), "health");
  assert.equal(resolveAdminNavId("/admin/operations", q("")), "subscriptions");
  assert.equal(resolveAdminNavId("/admin/operations", q("section=unknown")), "subscriptions");
  assert.equal(resolveAdminNavId("/admin/not-a-real-page", q("")), "overview");
});

test("AdminFrame views match their navigation entries", () => {
  const billing = fs.readFileSync("src/app/admin/billing/layout.tsx", "utf8");
  const launch = fs.readFileSync("src/app/admin/launch/layout.tsx", "utf8");
  assert.match(billing, /view="billing-center"/);
  assert.match(launch, /view="launch"/);
});

test("merged modules live on tabbed pages and keep old routes alive", () => {
  const views = fs.readFileSync("src/lib/admin-views.ts", "utf8");
  const billing = fs.readFileSync("src/app/admin/billing/page.tsx", "utf8");
  const fi = fs.readFileSync("src/app/admin/financial-intelligence/page.tsx", "utf8");
  const operations = fs.readFileSync("src/app/admin/operations/page.tsx", "utf8");
  const economics = fs.readFileSync("src/app/admin/economics/page.tsx", "utf8");
  // Both destinations are tabbed and every tab has its own URL.
  assert.match(views, /billingViews/);
  assert.match(views, /href: "\/admin\/billing\?tab=pricing"/);
  assert.match(views, /financialViews/);
  assert.match(views, /href: "\/admin\/financial-intelligence\?tab=provider-costs"/);
  assert.match(billing, /<AdminTabs/);
  assert.match(fi, /<AdminTabs/);
  // Billing has one switcher: every catalog section is a top-level tab.
  const center = fs.readFileSync("src/components/admin-billing-center.tsx", "utf8");
  for (const section of ["coupons", "addons", "seats", "audit"]) {
    assert.match(views, new RegExp(`href: "/admin/billing\\?tab=${section}"`));
  }
  assert.match(center, /section: BillingSection/);
  assert.doesNotMatch(center, /bc-nav|label="Billing sections"/);
  // One header for the page, not one per section body.
  assert.match(billing, /<AdminPageHeader/);
  assert.doesNotMatch(center, /<AdminPageHeader/);
  // KPI hints point at the tabs that fix the problem.
  assert.match(center, /href="\/admin\/billing\?tab=coupons"/);
  assert.match(center, /href="\/admin\/billing\?tab=audit"/);
  // Account deep links still open the seats view.
  assert.match(billing, /userId \? "seats"/);
  // Old entry points redirect instead of 404ing.
  assert.match(operations, /if \(section === "pricing"\) redirect\("\/admin\/billing\?tab=pricing"\)/);
  assert.match(economics, /redirect\("\/admin\/financial-intelligence\?tab=provider-costs"\)/);
  // Delegated pricing staff keep the page, and only the pricing tab.
  assert.match(billing, /requireAdminPage\(\["pricing"\]\)/);
  assert.match(billing, /access\.role === "master_admin"/);
  assert.match(billing, /billingViews\.filter\(/);
  // Provider costs stays master-admin only.
  assert.match(fi, /requireAdminPage\(\)/);
});
