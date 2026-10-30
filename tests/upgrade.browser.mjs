import fs from "node:fs";
fs.mkdirSync("test-results", { recursive: true });
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  ...(process.env.CHROME_EXECUTABLE
    ? { executablePath: process.env.CHROME_EXECUTABLE }
    : {}),
  headless: true,
});
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:3100/sign-in");
  const auth = await context.request.post("http://localhost:3100/api/auth", {
    headers: { Origin: "http://localhost:3100" },
    data: {
      action: "sign-in",
      email: "alice@example.com",
      password: "An-isolated-password-123456789!",
    },
  });
  assert.equal(auth.status(), 200, await auth.text());
  for (const route of [
    "calendar",
    "clients",
    "automation",
    "templates",
    "team",
    "payments",
    "billing",
  ]) {
    await page.goto("http://localhost:3100/app/" + route);
    await page.waitForTimeout(500);
    assert.equal(await page.locator("h1").count(), 1, route);
    assert(!(await page.getByText("Application error").count()), route);
    await page.screenshot({
      path: "test-results/upgrade-" + route + "-desktop.png",
      fullPage: true,
    });
  }
  await page.goto("http://localhost:3100/app/calendar");
  await page.getByLabel("Calendar view").selectOption("month");
  await page
    .getByRole("button", { name: "+ New appointment", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  await page.screenshot({
    path: "test-results/upgrade-create-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of [
    "calendar",
    "clients",
    "automation",
    "templates",
    "team",
    "payments",
    "billing",
  ]) {
    await page.goto("http://localhost:3100/app/" + route);
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    assert(!overflow, "Horizontal overflow: " + route);
    await page.screenshot({
      path: "test-results/upgrade-" + route + "-mobile.png",
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("http://localhost:3100/app/templates");
  await page
    .getByRole("button", { name: "Use template", exact: true })
    .first()
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Browser Fixture Client");
  await page
    .getByLabel("Email", { exact: true })
    .fill("browser-fixture@example.com");
  await page
    .getByRole("button", { name: "Prepare draft for review", exact: true })
    .click();
  await page.waitForURL("**/app/documents?envelope=*");
  await page.locator("canvas").first().waitFor();
  await page.waitForFunction(
    () => document.querySelector("canvas")?.dataset.rendered === "true",
  );
  assert(
    await page
      .locator("canvas")
      .first()
      .evaluate((canvas) => {
        const pixels = canvas
          .getContext("2d")
          .getImageData(0, 0, canvas.width, canvas.height).data;
        let ink = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (
            pixels[i] < 150 &&
            pixels[i + 1] < 150 &&
            pixels[i + 2] < 150 &&
            pixels[i + 3] > 0
          )
            ink++;
        return ink > 100;
      }),
    "PDF canvas must contain rendered text",
  );
  await page.getByRole("button", { name: "Save as template", exact: true }).waitFor();
  await page.screenshot({
    path: "test-results/upgrade-template-draft-desktop.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS browser: seven authenticated upgrade pages desktop/mobile, month view, manual appointment dialog, no horizontal overflow or page exceptions.",
  );
} finally {
  await browser.close();
}
