import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const origin = process.env.TEST_APP_URL;
if (!origin || !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) {
  throw Error("Local fixtures only");
}

mkdirSync("test-results/theme", { recursive: true });

function contrastHelpers() {
  return {
    rgb: (v) => v.match(/\d+/g)?.slice(0, 3).map(Number) || [0, 0, 0],
    lum: ([r, g, b]) => {
      const c = [r, g, b].map((n) => {
        const s = n / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    },
    contrast(a, b) {
      const { rgb, lum } = this;
      const [l1, l2] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x);
      return (l1 + 0.05) / (l2 + 0.05);
    },
  };
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(origin + "/demo", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ }).waitFor();

  await page.evaluate(() => {
    localStorage.setItem("zenvio-theme", "dark");
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.themeMode = "dark";
    document.documentElement.style.colorScheme = "dark";
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ }).waitFor();

  const metrics = await page.evaluate((helpersSrc) => {
    const helpers = new Function(`return (${helpersSrc})`)()();
    const root = getComputedStyle(document.documentElement);
    const heading = getComputedStyle(document.querySelector(".page-header h1"));
    const card = getComputedStyle(document.querySelector(".stat-card"));
    const cardLabel = getComputedStyle(document.querySelector(".stat-card > div"));
    const topbar = getComputedStyle(document.querySelector(".shell-topbar"));
    // Prefer the opaque painted canvas (body / html) over transparent wrappers.
    const pageBg = getComputedStyle(document.body).backgroundColor;
    return {
      theme: document.documentElement.dataset.theme,
      pageToken: root.getPropertyValue("--surface-page").trim(),
      pageBg,
      headingColor: heading.color,
      headingContrast: helpers.contrast(heading.color, pageBg),
      cardBg: card.backgroundColor,
      cardLabelColor: cardLabel.color,
      cardContrast: helpers.contrast(cardLabel.color, card.backgroundColor),
      topbarBg: topbar.backgroundColor,
      shellBgImage: getComputedStyle(document.querySelector(".shell")).backgroundImage,
    };
  }, contrastHelpers.toString());
  assert.match(metrics.shellBgImage, /rgb\(21,\s*29,\s*56\)|rgb\(26,\s*35,\s*64\)|#151d38|#1a2340/i);
  // Dark hero heading must stay white; Open schedule keeps an inverse light button.
  const hero = await page.evaluate((helpersSrc) => {
    const helpers = new Function(`return (${helpersSrc})`)()();
    const h2 = document.querySelector(".overview-brief h2");
    const btn = document.querySelector(".overview-brief .button");
    if (!h2 || !btn) return null;
    const hs = getComputedStyle(h2);
    const bs = getComputedStyle(btn);
    const brief = getComputedStyle(document.querySelector(".overview-brief"));
    return {
      headingContrast: helpers.contrast(hs.color, brief.backgroundColor),
      buttonContrast: helpers.contrast(bs.color, bs.backgroundColor),
      buttonBg: bs.backgroundColor,
    };
  }, contrastHelpers.toString());
  if (hero) {
    assert.ok(hero.headingContrast >= 4.5, `hero heading contrast ${hero.headingContrast}`);
    assert.ok(hero.buttonContrast >= 4.5, `open schedule contrast ${hero.buttonContrast}`);
    assert.match(hero.buttonBg, /rgb\(255,\s*255,\s*255\)|#fff/i);
  }

  assert.equal(metrics.theme, "dark");
  assert.match(metrics.pageToken, /#1a2340/i);
  assert.ok(metrics.headingContrast >= 4.5, `heading contrast ${metrics.headingContrast}`);
  assert.ok(metrics.cardContrast >= 3, `card label contrast ${metrics.cardContrast}`);

  // Pixel proof: the main canvas must not stay the old light gray (#f4f5f8).
  const canvasShot = await page.screenshot({ path: "test-results/theme/demo-dark-1440.png", fullPage: false, type: "png" });
  {
    const { default: sharp } = await import("sharp");
    const { data, info } = await sharp(canvasShot).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    const i = (220 * info.width + 500) * 4;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    assert.ok(r < 50 && g < 55 && b < 90, `canvas pixel stayed light: rgb(${r},${g},${b})`);
  }
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.screenshot({ path: "test-results/theme/demo-dark-768.png", fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/theme/demo-dark-390.png", fullPage: false });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.screenshot({ path: "test-results/theme/demo-dark-320.png", fullPage: false });

  // Representative demo module routes
  await page.setViewportSize({ width: 1440, height: 1000 });
  const routes = [
    ["bookings", "/demo?view=bookings", /Bookings/],
    ["event-types", "/demo?view=event-types", /Booking links/],
    ["availability", "/demo?view=availability", /Availability/],
    ["contacts", "/demo?view=contacts", /Clients/],
    ["settings", "/demo?view=settings", /Settings/],
  ];
  for (const [name, path, heading] of routes) {
    await page.goto(origin + path, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: heading }).waitFor();
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    assert.equal(theme, "dark", `${name} lost dark theme`);
    const surface = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const bodyBg = getComputedStyle(document.body).backgroundColor;
      const shellBg = getComputedStyle(document.querySelector(".shell")).backgroundImage;
      return {
        pageToken: root.getPropertyValue("--surface-page").trim(),
        bodyBg,
        shellBg,
      };
    });
    assert.match(surface.pageToken, /#1a2340/i, `${name} page token`);
    assert.match(surface.bodyBg, /rgb\(26,\s*35,\s*64\)/, `${name} body ${surface.bodyBg}`);
    assert.match(surface.shellBg, /rgb\(26,\s*35,\s*64\)/, `${name} shell ${surface.shellBg}`);
    await page.screenshot({ path: `test-results/theme/demo-${name}-dark-1440.png`, fullPage: false });
  }

  // Theme control: dark → light → persistence after reload
  await page.goto(origin + "/demo", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ }).waitFor();
  await page.getByRole("button", { name: /Theme:/ }).click();
  await page.getByRole("menuitemradio", { name: "Light" }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.screenshot({ path: "test-results/theme/demo-light-1440.png", fullPage: false });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ }).waitFor();
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "light",
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("zenvio-theme")),
    "light",
  );

  // System preference while mode is auto
  await page.getByRole("button", { name: /Theme:/ }).click();
  await page.getByRole("menuitemradio", { name: /System|Auto/i }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");

  console.log("PASS theme browser dark/light contrast, routes, persistence, system", metrics);
} finally {
  await browser.close();
}
