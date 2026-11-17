import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";

const origin = process.env.SMOKE_ORIGIN || "https://gozenvio.com";
const out = process.env.SMOKE_OUT || "test-results/launch-audit";
const artifacts = process.env.SMOKE_ARTIFACTS || "";
fs.mkdirSync(out, { recursive: true });
if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
const routes = [
  "/", "/pricing", "/sign-up", "/sign-in", "/help", "/contact", "/support",
  "/demo", "/early-access", "/privacy", "/terms",
];
// Marketplace is intentionally notFound() when platform_settings.marketplace.visible !== true.
const gated = ["/marketplace"];
const widths = [375, 768, 1024, 1440, 1920];
const browser = await chromium.launch({ headless: true });
const results = [];
const pageErrors = [];
try {
  const page = await browser.newPage();
  let current = { route: "", width: 0 };
  page.on("pageerror", (e) => {
    pageErrors.push({ type: "pageerror", route: current.route, width: current.width, message: e.message });
  });
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 800 ? 812 : 900 });
    for (const route of routes) {
      current = { route, width };
      const beforeErrors = pageErrors.length;
      const response = await page.goto(origin + route, { waitUntil: "domcontentloaded", timeout: 45000 });
      const status = response?.status() ?? 0;
      await page.locator("h1").first().waitFor({ timeout: 20000 }).catch(() => null);
      await page.evaluate(() => document.fonts.ready).catch(() => null);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      const appError = await page.getByText("Application error", { exact: true }).count();
      const inviteOnly = await page.getByText("Signup is by invitation", { exact: false }).count();
      const routeErrors = pageErrors.slice(beforeErrors);
      const row = { route, width, status, overflow, appError, inviteOnly, pageErrors: routeErrors.map((e) => e.message) };
      results.push(row);
      assert.equal(status, 200, `${route} status ${status}`);
      assert.ok(overflow <= 2, `${route}@${width} overflow ${overflow}`);
      assert.equal(appError, 0, `${route} application error`);
      assert.equal(routeErrors.length, 0, `${route}@${width} pageerror: ${routeErrors.map((e) => e.message).join("; ")}`);
      if (route === "/sign-up") assert.equal(inviteOnly, 0, "public signup must not show invitation-only copy when open");
      if ([375, 1440].includes(width) && ["/", "/pricing", "/sign-up", "/help"].includes(route)) {
        const file = `public-${route.replaceAll("/", "_") || "home"}-${width}.png`;
        await page.screenshot({ path: `${out}/${file}`, fullPage: false });
        if (artifacts) fs.copyFileSync(`${out}/${file}`, `${artifacts}/${file}`);
      }
      console.log(`OK ${route} @${width} overflow=${overflow}`);
    }
  }
  // Theme check: force dark on pricing
  current = { route: "/pricing", width: 1440 };
  await page.addInitScript(() => localStorage.setItem("zenvio-theme", "dark"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin + "/pricing", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  });
  await page.screenshot({ path: `${out}/pricing-dark-1440.png`, fullPage: false });
  if (artifacts) fs.copyFileSync(`${out}/pricing-dark-1440.png`, `${artifacts}/pricing-dark-1440.png`);
  // Config + health
  const config = await (await page.request.get(origin + "/api/config")).json();
  const health = await (await page.request.get(origin + "/api/health")).json();
  for (const route of gated) {
    current = { route, width: 1440 };
    const response = await page.goto(origin + route, { waitUntil: "domcontentloaded", timeout: 45000 });
    const status = response?.status() ?? 0;
    results.push({ route, width: 1440, status, gated: true, pageErrors: [] });
    assert.equal(status, 404, `${route} should stay gated closed until marketplace visibility is enabled`);
    console.log(`OK gated ${route} status=${status}`);
  }
  assert.equal(pageErrors.length, 0, `pageerrors remaining: ${JSON.stringify(pageErrors)}`);
  const report = { config, health, pageErrors, results };
  fs.writeFileSync(`${out}/prod-smoke.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ config, health, checks: results.length, pageErrors: pageErrors.length }, null, 2));
} finally {
  await browser.close();
}
