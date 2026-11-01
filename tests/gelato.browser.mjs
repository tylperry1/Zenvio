// Browser acceptance for the Gelato marketplace UI against a local production
// server and disposable database. Gelato network calls are not made: the
// imported product is seeded exactly as an admin import would store it.
import fs from "node:fs";
import assert from "node:assert/strict";
import pg from "pg";
import sharp from "sharp";
import { chromium } from "playwright";

const base = process.env.TEST_APP_URL || "http://localhost:3100";
const connection = process.env.TEST_DATABASE_URL;
if (!connection || !["127.0.0.1", "localhost"].includes(new URL(connection).hostname)) throw Error("Isolated localhost TEST_DATABASE_URL required");
fs.mkdirSync("test-results", { recursive: true });
const pool = new pg.Pool({ connectionString: connection });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
const errors = [];
const shot = (page, name) => page.screenshot({ path: `test-results/gelato-${name}.png`, fullPage: true });
const noOverflow = async (page, label) => assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "Horizontal overflow: " + label);
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/sign-in");
  const email = `gelato-admin-${Date.now()}@example.com`;
  const signup = await context.request.post(base + "/api/auth", { headers: { Origin: base }, data: { action: "sign-up", email, password: "An-isolated-password-123456789!", name: "Gelato Admin" } });
  assert.equal(signup.status(), 200, await signup.text());
  const user = (await pool.query('SELECT id FROM public."user" WHERE email=$1', [email])).rows[0].id;
  await pool.query('UPDATE public."user" SET "emailVerified"=true WHERE id=$1', [user]);
  await pool.query("INSERT INTO private.platform_roles(user_id) VALUES($1) ON CONFLICT DO NOTHING", [user]);

  // Seed one imported Gelato product with two sizes, as importProducts stores it.
  const supplier = (await pool.query("SELECT id FROM private.marketplace_suppliers WHERE connector='gelato'")).rows[0].id;
  const title = `Classic crew tee ${Date.now().toString(36)}`;
  const product = (
    await pool.query(
      "INSERT INTO private.marketplace_products(sku,title,description,category,price_cents,cost_cents,shipping_cents,minimum_quantity,supplier_id,supplier_sku,fulfillment,lead_time,status) VALUES($1,$3,'Soft ringspun cotton tee, printed on demand with your logo.','T-shirts',1999,850,0,1,$2,'t-shirts','print_on_demand','3–5 business days','draft') RETURNING id",
      ["GEL-BROWSER-" + Date.now(), supplier, title],
    )
  ).rows[0].id;
  const sp = (
    await pool.query(
      "INSERT INTO private.supplier_products(provider,product_id,catalog_uid,supplier_title,print_areas,sync_status,last_synced_at) VALUES('gelato',$1,'t-shirts','T-shirt',$2,'ok',now()) RETURNING id",
      [product, JSON.stringify([{ key: "front", label: "Front", file_type: "default", width_mm: 254, height_mm: 305, bleed_mm: 0, safe_mm: 5, min_dpi: 150 }, { key: "back", label: "Back", file_type: "back", width_mm: 254, height_mm: 305, bleed_mm: 0, safe_mm: 5, min_dpi: 150 }])],
    )
  ).rows[0].id;
  for (const [size, color] of [["S", "White"], ["M", "White"], ["M", "Navy"]])
    await pool.query(
      "INSERT INTO private.supplier_variants(supplier_product_id,provider,supplier_uid,label,size,color,availability,cost_cents,price_tiers) VALUES($1,'gelato',$2,$3,$4,$5,'available',850,$6)",
      [sp, `apparel_browser_${size}_${color}_${Date.now()}`, `${size} · ${color}`, size, color, JSON.stringify([{ quantity: 1, cost_cents: 850 }, { quantity: 10, cost_cents: 8000 }])],
    );
  await pool.query("UPDATE private.supplier_integrations SET enabled=true,status='connected',last_success_at=now(),last_checked_at=now(),capabilities='{\"catalogCount\":12,\"productCatalog\":true}' WHERE provider='gelato'");
  await pool.query("UPDATE private.marketplace_suppliers SET active=true WHERE connector='gelato'");

  // ---------- Admin console ----------
  await page.goto(base + "/admin/gelato");
  await page.getByRole("heading", { name: "Gelato", exact: true }).waitFor();
  await page.getByText("Connected").first().waitFor();
  await shot(page, "admin-overview");
  await page.getByRole("button", { name: /Imported products/ }).click();
  await page.getByText(title).click();
  await page.getByRole("dialog").getByText("Options from Gelato").waitFor();
  await shot(page, "admin-product-drawer");
  await page.getByRole("dialog").getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByText("Published. The product is now visible").waitFor();
  assert.equal((await pool.query("SELECT status FROM private.marketplace_products WHERE id=$1", [product])).rows[0].status, "active");
  await page.getByRole("button", { name: "Close" }).first().click();
  await page.getByRole("button", { name: "Sync & logs" }).click();
  await page.getByText("Synchronization history").waitFor();
  await page.getByRole("button", { name: /^Orders/ }).click();
  await page.getByText("No orders here").waitFor();
  const audit = (await pool.query("SELECT count(*)::int n FROM private.operation_log WHERE action='gelato_product_publish' AND actor_id=$1", [user])).rows[0].n;
  assert.equal(audit, 1, "publishing is audited");

  // ---------- Storefront and product page ----------
  await page.goto(base + "/marketplace");
  await page.getByRole("link", { name: title, exact: true }).waitFor();
  await shot(page, "storefront");
  await page.getByRole("button", { name: "Customizable" }).click();
  await page.getByRole("link", { name: "Customize" }).first().waitFor();
  await page.getByRole("link", { name: title, exact: true }).click();
  await page.getByRole("heading", { name: title }).waitFor();
  await page.getByText("Quantity pricing (per item)").waitFor();
  assert(!(await page.content()).includes("8.50"), "supplier cost is never shown");
  await page.getByRole("button", { name: "Navy" }).click();
  await shot(page, "product");
  await page.getByRole("link", { name: "Customize this product" }).click();

  // ---------- Brand Studio ----------
  await page.getByText("Zenvio Brand Studio").waitFor();
  const logo = await sharp({ create: { width: 2400, height: 1200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from('<svg width="2400" height="1200"><rect x="200" y="200" width="2000" height="800" rx="120" fill="#365cff"/></svg>') }])
    .png()
    .toBuffer();
  fs.writeFileSync("test-results/gelato-logo.png", logo);
  await page.locator('input[type="file"]').setInputFiles("test-results/gelato-logo.png");
  await page.locator(".studio-layer").first().waitFor();
  await page.getByRole("button", { name: "Add text" }).click();
  await page.getByLabel("Text", { exact: true }).fill("ZENVIO CREW");
  await page.getByRole("button", { name: "Save design" }).click();
  await page.getByText(/Design saved/).waitFor();
  await shot(page, "studio");
  await page.getByRole("button", { name: "Review & approve proof" }).click();
  await page.getByLabel(/I reviewed my design/).check();
  await page.getByRole("dialog").getByRole("button", { name: "Approve proof" }).click();
  await page.getByText("Proof approved.").waitFor();
  const proofLink = page.getByRole("link", { name: /Download production proof/ });
  const proof = await context.request.get(base + (await proofLink.getAttribute("href")));
  assert.equal(proof.headers()["content-type"], "application/pdf");
  assert.equal((await proof.body()).subarray(0, 5).toString(), "%PDF-");
  // Live fulfillment is off (and this server has no public HTTPS origin), so purchase is withheld.
  await page.getByText(/not open for purchase|not available in this environment/).waitFor();
  assert.equal(await page.getByRole("button", { name: "Add to cart" }).count(), 0);
  await shot(page, "studio-approved");
  const designId = new URL(page.url()).searchParams.get("design");
  const variantId = (await pool.query("SELECT variant_id FROM private.saved_designs WHERE id=$1", [designId])).rows[0].variant_id;
  await page.evaluate(
    ([productId, variantId, designId, title]) =>
      localStorage.setItem("zenvio-market-cart-v1", JSON.stringify([{ key: `${productId}:${variantId}:${designId}`, productId, variantId, designId, quantity: 2, title, detail: "M · Navy", price: 1999, shipping: 0, minimum: 1, custom: true }])),
    [product, variantId, designId, title],
  );

  // ---------- Cart: address and live-quote messaging; checkout stays closed ----------
  await page.goto(base + "/marketplace#cart");
  await page.getByText("Shipping address").waitFor();
  await page.getByText("Live quote at checkout").waitFor();
  assert(await page.getByRole("button", { name: /Checkout opening soon/ }).isDisabled(), "checkout is closed until enabled");
  await shot(page, "cart");

  // ---------- Mobile ----------
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/marketplace", `/marketplace/p/${product}`, `/marketplace/studio/${product}`, "/marketplace/orders", "/admin/gelato"]) {
    await page.goto(base + path);
    await page.waitForTimeout(700);
    await noOverflow(page, path);
    await shot(page, "mobile-" + path.split("/").filter(Boolean).slice(0, 2).join("-").replace(/[^a-z0-9-]/gi, ""));
  }

  // ---------- Guests ----------
  const guest = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const gp = await guest.newPage();
  gp.on("pageerror", (e) => errors.push(e.message));
  await gp.goto(base + "/marketplace");
  await gp.waitForURL("**/sign-in");
  await pool.query("UPDATE private.platform_settings SET value=value||'{\"guestCheckoutEnabled\":true}'::jsonb WHERE key='marketplace'");
  await gp.goto(base + "/marketplace");
  await gp.getByRole("link", { name: "Track an order" }).first().waitFor();
  await gp.getByRole("link", { name: title, exact: true }).waitFor();
  await shot(gp, "guest-storefront");
  await gp.goto(base + "/marketplace/track");
  await gp.getByRole("heading", { name: "Find your order" }).waitFor();
  const lookup = await guest.request.post(base + "/api/marketplace/track", { headers: { Origin: base }, data: { action: "lookup", email: "nobody@example.com", orderNumber: "ZV-0000000000" } });
  assert.equal(lookup.status(), 200, "lookup never reveals whether an order exists");
  const admin = await guest.request.get(base + "/api/admin/gelato");
  assert.equal(admin.status(), 401, "admin API rejects anonymous visitors");
  await pool.query("UPDATE private.platform_settings SET value=value||'{\"guestCheckoutEnabled\":false}'::jsonb WHERE key='marketplace'");

  // ---------- Non-admin users cannot reach the console or other users' artwork ----------
  const member = await browser.newContext();
  const memberEmail = `member-${Date.now()}@example.com`;
  await member.request.post(base + "/api/auth", { headers: { Origin: base }, data: { action: "sign-up", email: memberEmail, password: "An-isolated-password-123456789!", name: "Member" } });
  assert.equal((await member.request.get(base + "/api/admin/gelato")).status(), 403);
  const asset = (await pool.query("SELECT id FROM private.brand_assets WHERE user_id=$1 LIMIT 1", [user])).rows[0].id;
  assert.equal((await member.request.get(`${base}/api/marketplace/studio/asset-image?id=${asset}`)).status(), 404);
  assert.equal((await member.request.post(base + "/api/admin/gelato", { headers: { Origin: base }, data: { action: "settings", enabled: false } })).status(), 403);

  assert.deepEqual(errors, []);
  console.log("PASS: admin console, publish + audit, storefront, product page, Brand Studio upload/text/save/approve/PDF proof, cart, guest storefront, access control, and 390px layouts without overflow.");
} finally {
  await browser.close();
  await pool.end();
}
