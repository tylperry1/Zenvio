import { chromium } from "playwright";
import { mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const origin = process.env.CAPTURE_ORIGIN || "https://gozenvio.com";
const outDirs = ["test-results/ui-ux-2.0", "/opt/cursor/artifacts", "/cursor/stores/self/media/ui-ux-2.0"];
for (const d of outDirs) mkdirSync(d, { recursive: true });

const shots = [
  { path: "/", name: "prod-landing", width: 1440 },
  { path: "/pricing", name: "prod-pricing", width: 1440 },
  { path: "/demo", name: "prod-demo", width: 1440 },
  { path: "/demo", name: "prod-demo-mobile", width: 390 },
  { path: "/pricing", name: "prod-pricing-mobile", width: 390 },
];

const browser = await chromium.launch({ headless: true });
try {
  for (const shot of shots) {
    const page = await browser.newPage({ viewport: { width: shot.width, height: 900 } });
    await page.goto(origin + shot.path, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    const file = `${shot.name}-${shot.width}.png`;
    const local = join("test-results/ui-ux-2.0", file);
    await page.screenshot({ path: local, fullPage: false });
    for (const d of outDirs.slice(1)) {
      try {
        copyFileSync(local, join(d, file));
      } catch {}
    }
    console.log("saved", local);
    await page.close();
  }
} finally {
  await browser.close();
}
