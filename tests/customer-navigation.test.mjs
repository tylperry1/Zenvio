import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

function loadTs(file) {
  const filename = path.resolve(file);
  const mod = new Module(filename);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText,
    filename,
  );
  return mod.exports;
}

const nav = loadTs("src/lib/customer-nav.ts");
const shell = fs.readFileSync("src/components/app-shell.tsx", "utf8");

const routeExists = (href) => {
  const pathname = href.split("?")[0];
  return fs.existsSync(`src/app${pathname}/page.tsx`) || fs.existsSync(`src/app${pathname}/route.ts`);
};

test("every customer destination is a real route and none are duplicated", () => {
  const items = nav.allNavItems();
  assert.ok(items.length >= 15, "the model covers the working product");
  for (const item of items) {
    assert.ok(routeExists(item.href), `${item.label} points at a missing page: ${item.href}`);
    if (item.demoHref) assert.ok(routeExists(item.demoHref), `demo destination missing: ${item.demoHref}`);
  }
  const ids = new Set();
  for (const item of items) {
    assert.ok(!ids.has(item.id), `duplicate navigation id ${item.id}`);
    ids.add(item.id);
  }
  const labelled = items.filter((item) => item.href !== "/app");
  assert.equal(new Set(labelled.map((item) => item.label)).size, labelled.length, "labels must be unique");
});

test("workspace views stay on the existing query routes so bookmarks keep working", () => {
  const items = nav.allNavItems();
  const views = items.filter((item) => item.view !== undefined).map((item) => item.view);
  assert.deepEqual(new Set(views), new Set(["", "bookings", "event-types", "availability", "settings"]));
  const workspace = fs.readFileSync("src/components/workspace.tsx", "utf8");
  for (const slug of ["event-types", "bookings", "availability", "settings"]) {
    assert.match(workspace, new RegExp(`${slug}: "${slug}"|"${slug}"|${slug}`));
  }
  assert.match(fs.readFileSync("src/app/app/page.tsx", "utf8"), /<Workspace \/>/);
});

test("the primary structure follows the customer job", () => {
  const groups = nav.customerNavGroups.map((group) => [group.id, group.label, group.items.map((item) => item.label)]);
  assert.deepEqual(groups[0], ["workspace", "Workspace", ["Overview", "Calendar", "Appointments", "Customers", "Inbox"]]);
  assert.equal(groups.at(-1)[0], "account");
  assert.ok(groups.at(-1)[2].includes("Settings"));
  assert.ok(groups.at(-1)[2].includes("Plan & billing"));
  assert.equal(groups.find((group) => group[0] === "connected")[2][0], "Integrations");
});

test("role and launch visibility never exposes a destination the user cannot use", () => {
  const base = { trade: false, marketplace: false, role: "staff", features: { smartCards: false, growth: false } };
  const labels = nav.visibleNavGroups(base).flatMap((group) => group.items.map((item) => item.label));
  assert.ok(!labels.includes("Smart Cards"), "disabled Smart Cards feature is hidden");
  assert.ok(!labels.includes("Growth"), "disabled Growth feature is hidden");
  assert.ok(!labels.includes("Jobs & estimates"), "trade-only job tools stay hidden");
  assert.ok(!labels.includes("Marketplace"), "hidden storefront stays hidden");
  assert.ok(labels.includes("Settings"), "every member can reach their own settings");

  const owner = nav.visibleNavGroups({ ...base, trade: true, marketplace: true, role: "owner", features: { smartCards: true, growth: true } })
    .flatMap((group) => group.items.map((item) => item.label));
  for (const label of ["Smart Cards", "Growth", "Jobs & estimates", "Marketplace"]) assert.ok(owner.includes(label), label);

  const gated = { id: "owners", label: "Owners", icon: "shield", href: "/app", roles: ["owner"] };
  assert.equal(nav.navItemVisible(gated, { role: "staff" }), false);
  assert.equal(nav.navItemVisible(gated, { role: "owner" }), true);
});

test("customer navigation never includes platform management or legacy pricing", () => {
  assert.doesNotMatch(shell, /Revenue Center|Master Admin|revenue-center/i);
  const source = fs.readFileSync("src/lib/customer-nav.ts", "utf8");
  assert.doesNotMatch(source, /Revenue Center|Master Admin/i);
  assert.doesNotMatch(source, /v3|v4|Pricing v|legacy subscription/i);
  const admin = shell.match(/href="\/admin"/g) || [];
  assert.ok(admin.length >= 1);
  // Every admin link in the shell is behind the master-admin flag.
  assert.match(shell, /admin && !demo && \(/);
  assert.match(shell, /access\.admin && !access\.demo/);
});

test("billing has one canonical destination and no checkout deep links", () => {
  const billing = nav.allNavItems().filter((item) => /billing|plan/i.test(item.id + item.label));
  assert.deepEqual(billing.map((item) => item.href), ["/app/billing"]);
  assert.ok(routeExists("/app/billing"));
  const source = fs.readFileSync("src/lib/customer-nav.ts", "utf8");
  assert.doesNotMatch(source, /\/purchase|\/checkout|stripe\.com/i);
});

test("active states resolve per destination, view and section", () => {
  const cases = [
    ["/app", null, "overview"],
    ["/app", "bookings", "appointments"],
    ["/app", "event-types", "services"],
    ["/app", "availability", "availability"],
    ["/app", "settings", "settings"],
    ["/app/calendar", null, "calendar"],
    ["/app/clients", null, "customers"],
    ["/app/clients/abc", null, "customers"],
    ["/app/inbox", null, "inbox"],
    ["/app/documents", null, "documents"],
    ["/app/templates", null, "documents"],
    ["/app/business-profile", null, "business-profile"],
    ["/app/business-profile", null, "settings", "settings"],
    ["/app/business-profile", null, "smart-cards", "digital-card"],
    ["/app/marketing", null, "growth"],
    ["/app/growth", null, "growth"],
    ["/app/growth/overview", null, "growth"],
    ["/app/identity/nfc", null, "smart-cards"],
    ["/app/smart-cards/nfc-studio", null, "smart-cards"],
    ["/app/connections", null, "integrations"],
    ["/app/notifications", null, "notifications"],
    ["/app/team", null, "team"],
    ["/app/payments", null, "payments"],
    ["/app/automation", null, "automations"],
    ["/app/jobs", null, "jobs"],
    ["/marketplace", null, "marketplace"],
    ["/marketplace/orders", null, "marketplace"],
    ["/app/feedback", null, ""],
  ];
  for (const [pathname, view, expected, section] of cases) {
    assert.equal(nav.resolveActiveNavId(pathname, view, { section: section || null }), expected, `${pathname}${view ? `?view=${view}` : ""}`);
  }
  assert.equal(nav.resolveActiveNavId("/demo", "", { demo: true }), "overview");
  assert.equal(nav.resolveActiveNavId("/demo", "contacts", { demo: true }), "customers");
  assert.equal(nav.resolveActiveNavId("/demo", "bookings", { demo: true }), "appointments");
});

test("the demo keeps the same shell but only offers sample-data destinations", () => {
  const demoGroups = nav.visibleNavGroups({ demo: true });
  for (const group of demoGroups) {
    for (const item of group.items) assert.ok(item.demoHref, `${item.label} must map into /demo`);
  }
  const labels = demoGroups.flatMap((group) => group.items.map((item) => item.label));
  assert.ok(labels.includes("Overview"));
  assert.ok(labels.includes("Customers"));
  assert.ok(labels.includes("Settings"));
  assert.ok(!labels.includes("Plan & billing"));
});

test("mobile navigation is five thumb targets with the More sheet", () => {
  assert.deepEqual(
    nav.mobileNavItems.map((item) => item.label),
    ["Home", "Calendar", "Appointments", "Customers"],
  );
  assert.match(shell, /shell-bottom-nav/);
  assert.match(shell, />More</);
  assert.match(shell, /aria-expanded=\{moreOpen\}/);
  assert.match(shell, /role="dialog" aria-modal="true" aria-label="More navigation"/);
  assert.match(shell, /aria-current=\{active \? "page" : undefined\}/);
  const css = fs.readFileSync("src/app/shell.css", "utf8");
  assert.match(css, /\.shell-bottom-nav/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(css, /min-height: 46px/);
  // The desktop rail is not simply squeezed onto phones.
  assert.match(css, /\.shell \.shell-menu,\s*\n\s*\.shell \.shell-close,\s*\n\s*\.shell \.shell-sidebar \{ display: none; \}/);
});

test("the demo mobile bar hides destinations that have no demo route", () => {
  const demoBar = nav.mobileNavItems.filter((item) => item.demoHref);
  assert.deepEqual(
    demoBar.map((item) => item.label),
    ["Home", "Appointments", "Customers"],
    "Calendar has no /demo destination and must not render",
  );
  for (const item of demoBar) {
    assert.ok(item.demoHref.startsWith("/demo"), `${item.label} must stay inside /demo`);
    assert.ok(routeExists(item.demoHref.split("?")[0]), `missing demo page for ${item.label}`);
  }
  assert.match(shell, /access\.demo \? mobileNavItems\.filter\(\(item\) => item\.demoHref\) : mobileNavItems/);
  assert.match(shell, /gridTemplateColumns: `repeat\(\$\{items\.length \+ 1\}, minmax\(0, 1fr\)\)`/);
  assert.match(shell, /items: group\.items\.filter\(\(item\) => !primary\.some/);
});

test("public chrome follows the page theme", () => {
  const css = fs.readFileSync("src/app/public-site.css", "utf8");
  assert.match(css, /--zv-accent: var\(--action-primary\)/);
  assert.match(css, /background: color-mix\(in srgb, var\(--surface-card\) 94%, transparent\)/);
  assert.doesNotMatch(css, /(?:background|background-color):\s*#fff(?:fff)?\b/i);
  assert.match(css, /html\[data-theme="dark"\] \.zv-site-page \{[\s\S]*?--zv-cta: #2f5be0/);
  assert.match(css, /\.zv-site-cta \{[\s\S]*?background: var\(--zv-cta\)/);
  assert.match(css, /\.zv-site-page \{[\s\S]*?background: var\(--surface-page\)/);
  assert.match(css, /html\[data-theme="dark"\] \.zv-site-logo \.logo-light/);
  assert.doesNotMatch(css, /\.zv-site-header \{[^}]*background: #fff/);
  assert.doesNotMatch(css, /\.zv-site-footer \{[^}]*background: #f7f9ff/);
});

test("public navigation is consistent, real and free of duplicate actions", () => {
  const header = fs.readFileSync("src/components/public-site-header.tsx", "utf8");
  const siteNav = fs.readFileSync("src/components/public-site-nav.tsx", "utf8");
  for (const label of ["Home", "Features", "Pricing", "About"]) {
    assert.match(siteNav, new RegExp(`label: "${label}"`));
  }
  assert.match(siteNav, /Sign in/);
  assert.match(header, /Get started/);
  assert.match(header, /publicRegistrationOpen/);
  assert.equal((siteNav.match(/aria-current/g) || []).length >= 2, true);
  for (const file of ["src/app/features/page.tsx", "src/app/about/page.tsx"]) assert.ok(fs.existsSync(file), file);
  const home = fs.readFileSync("src/app/page.tsx", "utf8");
  assert.match(home, /<PublicSiteHeader \/>/);
  assert.match(home, /<PublicSiteFooter \/>/);
  assert.doesNotMatch(home, /mk-desktop-nav|mk-mobile-menu/);
  for (const page of ["src/app/pricing/page.tsx", "src/app/help/page.tsx", "src/app/contact/page.tsx"]) {
    assert.match(fs.readFileSync(page, "utf8"), /<PublicSiteHeader \/>/, page);
  }
  const sitemap = fs.readFileSync("src/app/sitemap.ts", "utf8");
  assert.match(sitemap, /"\/features"/);
  assert.match(sitemap, /"\/about"/);
});

test("settings present one organized directory of implemented surfaces only", () => {
  const workspace = fs.readFileSync("src/components/workspace.tsx", "utf8");
  assert.match(workspace, /className="settings-hub"/);
  for (const href of [
    "/app/notifications",
    "/app/business-profile",
    "/app/business-profile?section=branding",
    "/app/business-profile?section=booking",
    "/app?view=availability",
    "/app?view=event-types",
    "/app/team",
    "/app/billing",
    "/app/connections",
  ]) {
    assert.ok(workspace.includes(`href="${href}"`), `missing settings destination ${href}`);
  }
  assert.doesNotMatch(workspace, /Login and security|placeholder settings/i);
  // No new duplicate page was invented for settings.
  assert.equal(fs.existsSync("src/app/app/settings/page.tsx"), false);
});

test("the shell keeps accessibility affordances for its new surfaces", () => {
  assert.match(shell, /aria-label="Open navigation"/);
  assert.match(shell, /aria-controls="workspace-more-navigation"/);
  assert.match(shell, /event\.key === "Escape"/);
  assert.match(shell, /closeRef\.current\?\.focus\(\)/);
  assert.match(shell, /<summary>/);
  const css = fs.readFileSync("src/app/shell.css", "utf8");
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
});
