import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

/**
 * The billing page resolves the active view, its header and the staff filter on
 * the server. These tests render the real page module with a stubbed session so
 * that routing, permission filtering and the props handed to each view stay
 * pinned without a database.
 */

function loadTs(filename, mocks) {
  const mod = new Module(filename);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod);
  mod.require = (id) => (Object.hasOwn(mocks, id) ? mocks[id] : normal(id));
  mod._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );
  return mod.exports;
}

const views = loadTs(path.resolve("src/lib/admin-views.ts"), {});

// The strip is the real component, so its "one view renders no tabs" rule is
// covered too; only Next's Link and the data-loading modules are stubbed.
const tabs = loadTs(path.resolve("src/components/admin-tabs.tsx"), {
  "next/link": { __esModule: true, default: (props) => React.createElement("a", props, props.children) },
  "@/lib/admin-views": views,
});

let access = { role: "master_admin" };
let requestedPermissions;

const page = loadTs(path.resolve("src/app/admin/billing/page.tsx"), {
  "next/link": { __esModule: true, default: (props) => React.createElement("a", props, props.children) },
  "@/lib/page-session": {
    requireAdminPage: async (permission) => {
      requestedPermissions = permission;
      return { access };
    },
  },
  "@/lib/admin-views": views,
  "@/components/admin-tabs": tabs,
  "@/components/admin-page-header": {
    AdminPageHeader: ({ title, description, actions }) =>
      React.createElement(
        "header",
        { "data-title": title, "data-description": description, "data-actions": !!actions },
        actions || null,
      ),
  },
  "@/components/admin-billing-center": {
    AdminBillingCenter: ({ section }) => React.createElement("div", { "data-section": section }),
  },
  "@/components/admin-pricing": {
    AdminPricing: () => React.createElement("div", { "data-checkout": "pricing" }),
  },
  "@/components/route-loading": { RouteLoading: () => null },
});

const master = { role: "master_admin" };
const pricingStaff = { role: "staff", permissions: ["pricing"] };

async function render(params, who = master) {
  access = who;
  return renderToStaticMarkup(await page.default({ searchParams: Promise.resolve(params) }));
}

const decode = (value) =>
  value
    ?.replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
const attr = (html, name) => decode((html.match(new RegExp(`${name}="([^"]*)"`)) || [])[1]);
const tabLabels = (html) =>
  [...html.matchAll(/class="av-tabs"[\s\S]*?<\/nav>/g)].flatMap((m) =>
    [...m[0].matchAll(/>([^<>]+)<\/a>/g)].map((a) => decode(a[1])),
  );

test("the owner's default billing view is the catalog with every tab", async () => {
  const html = await render({});
  assert.equal(attr(html, "data-title"), "Billing & catalog");
  assert.match(attr(html, "data-description"), /Published prices, coupons, add-ons, seats/);
  assert.equal(attr(html, "data-actions"), "true");
  assert.equal(attr(html, "data-section"), "packages");
  assert.deepEqual(tabLabels(html), [
    "Packages",
    "Coupons",
    "Add-ons",
    "Seats",
    "Sync & audit",
    "Checkout pricing",
  ]);
  assert.match(html, /href="\/admin\/billing\?tab=pricing"/);
});

test("each catalog tab renders its section under the same header", async () => {
  for (const section of ["coupons", "addons", "seats", "audit"]) {
    const html = await render({ tab: section });
    assert.equal(attr(html, "data-section"), section, section);
    assert.equal(attr(html, "data-title"), "Billing & catalog", section);
    assert.equal(attr(html, "data-actions"), "true", section);
    assert.equal(tabLabels(html).length, 6, section);
  }
});

test("?userId deep links still open the seats view", async () => {
  const html = await render({ userId: "42" });
  assert.equal(attr(html, "data-section"), "seats");
  assert.equal(attr(html, "data-title"), "Billing & catalog");
});

test("the checkout tab swaps the view, header and action", async () => {
  const html = await render({ tab: "pricing" });
  assert.equal(attr(html, "data-title"), "Checkout pricing");
  assert.match(attr(html, "data-description"), /launch gates/);
  assert.equal(attr(html, "data-actions"), "false");
  assert.notEqual(attr(html, "data-checkout"), undefined);
  assert.equal(attr(html, "data-section"), undefined);
});

test("an unknown or retired tab falls back to the default view", async () => {
  for (const tab of ["catalog", "not-a-view"]) {
    const html = await render({ tab });
    assert.equal(attr(html, "data-section"), "packages", tab);
    assert.equal(attr(html, "data-title"), "Billing & catalog", tab);
  }
});

test("pricing-only staff get the checkout view and nothing else", async () => {
  const html = await render({}, pricingStaff);
  // The page asks for the one permission that also grants the checkout view.
  assert.deepEqual(requestedPermissions, ["pricing"]);
  assert.equal(attr(html, "data-title"), "Checkout pricing");
  assert.notEqual(attr(html, "data-checkout"), undefined);
  assert.equal(attr(html, "data-section"), undefined);
  // A single visible view renders no strip, and no catalog link leaks into it.
  assert.equal(tabLabels(html).length, 0);
  assert.doesNotMatch(html, /admin\/billing\?tab=/);
});

test("pricing-only staff cannot reach catalog sections by URL", async () => {
  for (const params of [{ tab: "seats" }, { tab: "audit" }, { userId: "42" }]) {
    const html = await render(params, pricingStaff);
    assert.equal(attr(html, "data-section"), undefined, JSON.stringify(params));
    assert.equal(attr(html, "data-title"), "Checkout pricing", JSON.stringify(params));
  }
});
