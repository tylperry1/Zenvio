// Responsive and keyboard checks for the Zenvio 2.1 screens. Runs after experience.integration.mjs
// (which creates the trade preset, a job and portal data) against the same isolated server.
import fs from "node:fs";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { Pool } from "pg";
import { startMockAnthropic } from "./support/mock-anthropic.mjs";
fs.mkdirSync("test-results", { recursive: true });
const origin = "http://localhost:3100";
const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const mock = await startMockAnthropic(4010);
const browser = await chromium.launch({ ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}), headless: true });
const errors = [];
async function noHorizontalScroll(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `${label} scrolls horizontally by ${overflow}px`);
}
try {
  await db.query("DELETE FROM private.request_limits");
  for (const viewport of [
    { name: "desktop", width: 1366, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${viewport.name}: ${e.message}`));
    await page.goto(origin + "/sign-in");
    const auth = await context.request.post(origin + "/api/auth", {
      headers: { Origin: origin },
      data: { action: "sign-in", email: "alice@example.com", password: "An-isolated-password-123456789!" },
    });
    assert.equal(auth.status(), 200);
    for (const route of ["assistant", "inbox", "jobs", "feedback"]) {
      await page.goto(`${origin}/app/${route}`);
      await page.waitForTimeout(600);
      assert.equal(await page.locator("h1").count(), 1, route);
      assert(!(await page.getByText("Application error").count()), route);
      await noHorizontalScroll(page, `${route} (${viewport.name})`);
      await page.screenshot({ path: `test-results/v21-${route}-${viewport.name}.png` });
    }

    // Assistant: suggested prompt streams a reply and an approval card; decline it.
    await page.goto(origin + "/app/assistant");
    await page.locator(".as-prompt", { hasText: "Send my booking link to Sarah." }).click();
    await page.getByText("Needs your approval").last().waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Decline" }).last().click();
    await page.getByText("Declined", { exact: true }).last().waitFor();

    // Launcher panel opens from any workspace page, with keyboard close.
    await page.goto(origin + "/app/clients");
    await page.getByRole("button", { name: "Open Zenvio Assistant" }).click();
    const panel = page.getByRole("dialog", { name: "Zenvio Assistant" });
    await panel.waitFor();
    await assert.doesNotReject(() => panel.locator("textarea").waitFor());
    await noHorizontalScroll(page, `assistant panel (${viewport.name})`);
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached" });

    // Client profile actions, including the shared booking-link dialog.
    await page.goto(origin + "/app/clients");
    await page.getByText("Sarah Client").first().click();
    await page.getByRole("button", { name: "Send booking link" }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByText("Text message").waitFor();
    assert.equal(await dialog.locator('input[type=radio][disabled]').count(), 1, "SMS is disabled while the provider is not connected");
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // Customer portal and service request form are usable on small screens.
    const contact = (await db.query("SELECT id FROM public.contacts WHERE email='morgan@example.com'")).rows[0];
    const link = await context.request.post(origin + "/api/portal/links", { headers: { Origin: origin }, data: { contactId: contact.id } });
    const portalUrl = (await link.json()).url.replace(/^https?:\/\/[^/]+/, origin);
    const guest = await (await browser.newContext({ viewport })).newPage();
    guest.on("pageerror", (e) => errors.push(`portal ${viewport.name}: ${e.message}`));
    await guest.goto(portalUrl);
    await guest.getByRole("heading", { name: /Hi Morgan/ }).waitFor();
    await guest.getByRole("tab", { name: /Estimates/ }).click();
    await guest.getByText("Estimate #").first().waitFor();
    await noHorizontalScroll(guest, `portal (${viewport.name})`);
    await guest.screenshot({ path: `test-results/v21-portal-${viewport.name}.png`, fullPage: true });
    const slug = (await db.query(`SELECT slug FROM public.profiles p JOIN public."user" u ON u.id=p.id WHERE u.email='alice@example.com'`)).rows[0].slug;
    await guest.goto(`${origin}/request/${slug}`);
    await guest.getByRole("heading", { name: /Request service/ }).waitFor();
    await noHorizontalScroll(guest, `request form (${viewport.name})`);
    await guest.screenshot({ path: `test-results/v21-request-${viewport.name}.png`, fullPage: true });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log("Zenvio 2.1 browser checks passed");
} finally {
  await browser.close();
  await mock.close();
  await db.end();
}
