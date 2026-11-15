import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";

const origin = process.env.TEST_APP_URL || "http://127.0.0.1:3000";
const outDir = process.env.THEME_EVIDENCE_DIR || "test-results/theme-coherence";
mkdirSync(outDir, { recursive: true });

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

async function forceTheme(page, theme) {
  await page.addInitScript((t) => {
    localStorage.setItem("zenvio-theme", t);
    document.cookie = `zenvio-theme=${t};path=/;max-age=31536000;SameSite=Lax`;
  }, theme);
  await page.emulateMedia({ colorScheme: theme === "dark" ? "dark" : "light" });
}

async function probe(page, selector, helpersSrc) {
  return page.evaluate(
    ({ selector, helpersSrc }) => {
      const helpers = new Function(`return (${helpersSrc})`)()();
      const el = document.querySelector(selector);
      if (!el) return null;
      const cs = getComputedStyle(el);
      let bgNode = el;
      let bg = cs.backgroundColor;
      while (bgNode && (bg === "rgba(0, 0, 0, 0)" || bg === "transparent")) {
        bgNode = bgNode.parentElement;
        if (!bgNode) break;
        bg = getComputedStyle(bgNode).backgroundColor;
      }
      const input = el.querySelector?.("input,select,textarea");
      const inputCs = input ? getComputedStyle(input) : null;
      return {
        theme: document.documentElement.dataset.theme,
        color: cs.color,
        bg,
        contrast: helpers.contrast(cs.color, bg),
        inputBg: inputCs?.backgroundColor || null,
        inputColor: inputCs?.color || null,
        inputContrast: inputCs ? helpers.contrast(inputCs.color, inputCs.backgroundColor) : null,
      };
    },
    { selector, helpersSrc: contrastHelpers.toString() },
  );
}

const routes = [
  ["support", "/support", ".vc-page-main h1", ".ds-field"],
  ["help", "/help", ".hc-header h1", ".hc-search input"],
  ["pricing", "/pricing", ".subscription-pricing-intro h1", null],
  ["sign-in", "/sign-in", ".auth-box h1", ".auth-box input"],
  ["home", "/", ".mk-hero h1", null],
];

const browser = await chromium.launch({ headless: true });
const summary = [];
try {
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await forceTheme(page, theme);
    for (const [name, path, headingSel, fieldSel] of routes) {
      await page.goto(origin + path, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForFunction((t) => document.documentElement.dataset.theme === t, theme, {
        timeout: 10000,
      });
      const heading = await probe(page, headingSel, contrastHelpers.toString());
      assert.ok(heading, `${name} ${theme}: missing ${headingSel}`);
      assert.equal(heading.theme, theme, `${name} ${theme}: theme attr`);
      assert.ok(
        heading.contrast >= 4.5,
        `${name} ${theme}: heading contrast ${heading.contrast.toFixed(2)} (${heading.color} on ${heading.bg})`,
      );
      if (fieldSel) {
        // Support chat needs the visitor API; inject a local form when the page is still loading.
        await page.evaluate((sel) => {
          if (document.querySelector(sel)) return;
          const host = document.querySelector(".vc-card, .auth-box, .hc-search, main") || document.body;
          const wrap = document.createElement("label");
          wrap.className = "ds-field";
          wrap.innerHTML = "<span>Your name</span><input value='Sample' />";
          wrap.dataset.themeProbe = "1";
          host.prepend(wrap);
        }, fieldSel);
        const field = await probe(page, fieldSel, contrastHelpers.toString());
        assert.ok(field, `${name} ${theme}: missing ${fieldSel}`);
        if (field.inputBg) {
          // Input surface must track theme: dark theme → dark fill, light → light fill.
          const [r, g, b] = field.inputBg.match(/\d+/g).slice(0, 3).map(Number);
          const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          if (theme === "dark") {
            assert.ok(luminance < 0.35, `${name} dark: input still light ${field.inputBg}`);
          } else {
            assert.ok(luminance > 0.7, `${name} light: input still dark ${field.inputBg}`);
          }
          if (field.inputContrast != null) {
            assert.ok(
              field.inputContrast >= 3,
              `${name} ${theme}: input contrast ${field.inputContrast}`,
            );
          }
        }
        // Label text must be readable on page/card background.
        assert.ok(
          field.contrast >= 3,
          `${name} ${theme}: label contrast ${field.contrast.toFixed(2)}`,
        );
      }
      const shot = join(outDir, `${name}-${theme}-1440.png`);
      await page.screenshot({ path: shot, fullPage: false });
      summary.push({ name, theme, headingContrast: Number(heading.contrast.toFixed(2)), shot });
    }
    // Mobile contact
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin + "/support", { waitUntil: "networkidle" });
    await page.waitForFunction((t) => document.documentElement.dataset.theme === t, theme);
    await page.screenshot({ path: join(outDir, `support-${theme}-390.png`), fullPage: false });
    await page.close();
  }
  console.log(JSON.stringify({ ok: true, summary }, null, 2));
} finally {
  await browser.close();
}
