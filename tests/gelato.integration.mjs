// End-to-end Gelato marketplace flow against a real, disposable localhost
// Postgres. Only external networks are substituted: Gelato (scripted transport),
// Stripe (session creation stub; real webhook signature verification) and email.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import pg from "pg";
import Stripe from "stripe";
import sharp from "sharp";

const connection = process.env.TEST_DATABASE_URL;
if (!connection || !["127.0.0.1", "localhost"].includes(new URL(connection).hostname)) throw Error("Isolated localhost TEST_DATABASE_URL required");
process.env.INTEGRATION_ENCRYPTION_KEY ||= "isolated-gelato-integration-key-123456";
process.env.NEXT_PUBLIC_APP_URL = "https://shop.test.example";
process.env.MASTER_ADMIN_EMAIL = "owner@example.com";
const pool = new pg.Pool({ connectionString: connection, max: 4 });
const secrets = { STRIPE_SECRET_KEY: "sk_test_isolated", STRIPE_MARKETPLACE_WEBHOOK_SECRET: "whsec_isolated_gelato", GELATO_API_KEY: "bad-key" };
const realStripe = new Stripe("sk_test_isolated_dummy");
const sessions = [];
const stripeStub = {
  checkout: {
    sessions: {
      create: async (input) => {
        const subtotal = input.line_items.reduce((n, l) => n + l.quantity * l.price_data.unit_amount, 0);
        const shipping = input.shipping_options[0].shipping_rate_data.fixed_amount.amount;
        const s = { id: "cs_gel_" + (sessions.length + 1), url: "https://checkout.stripe.com/x", metadata: input.metadata, currency: "usd", amount_subtotal: subtotal, amount_total: subtotal + shipping, total_details: { amount_shipping: shipping, amount_tax: 0 }, status: "open", payment_status: "unpaid", payment_intent: null, collected_information: { shipping_details: null } };
        sessions.push({ input, session: s });
        return s;
      },
      retrieve: async (id) => sessions.find((s) => s.session.id === id).session,
    },
  },
  webhooks: realStripe.webhooks,
};

// ---------- Scripted Gelato API ----------
const calls = [];
const gelato = { createMode: "ok", quoteUnitCost: "9.00", createdOrders: [], remoteStatus: "printed" };
const tshirt = (size) => ({ productUid: `apparel_product_gca_t-shirt_gsi_${size}_gco_white`, attributes: { GarmentSize: size.toUpperCase(), GarmentColor: "white" }, supportedCountries: ["US"], weight: { value: 180, measureUnit: "grams" } });
async function transport(url, init) {
  const u = new URL(url), method = init.method || "GET", body = init.body ? JSON.parse(init.body) : null;
  calls.push({ method, path: u.pathname, body });
  assert.equal(init.headers["X-API-KEY"], secrets.GELATO_API_KEY, "API key only in X-API-KEY header");
  const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  if (secrets.GELATO_API_KEY === "bad-key") return json(401, { message: "Unauthorized" });
  if (u.pathname === "/v3/catalogs") return json(200, { data: [{ catalogUid: "t-shirts", title: "T-shirts" }] });
  if (u.pathname === "/v3/catalogs/t-shirts/products:search") return json(200, { products: [tshirt("s"), tshirt("m")] });
  const product = u.pathname.match(/^\/v3\/products\/([^/]+)$/);
  if (product) return json(200, tshirt(decodeURIComponent(product[1]).match(/gsi_(\w)/)[1]));
  if (/^\/v3\/products\/[^/]+\/prices$/.test(u.pathname)) return json(200, [{ quantity: 1, price: 8.5, currency: "USD" }, { quantity: 10, price: "80.00", currency: "USD" }]);
  if (u.pathname === "/v4/orders:quote")
    return json(200, { quotes: [{ products: body.products.map((p) => ({ itemReferenceId: p.itemReferenceId, quantity: p.quantity, price: (Number(gelato.quoteUnitCost) * p.quantity).toFixed(2), currency: "USD" })), shipmentMethods: [{ shipmentMethodUid: "normal", name: "Standard", price: "5.25", currency: "USD", minDeliveryDays: 3, maxDeliveryDays: 6 }] }] });
  if (u.pathname === "/v4/orders" && method === "POST") {
    const created = { id: "gel-" + (gelato.createdOrders.length + 1), orderReferenceId: body.orderReferenceId, fulfillmentStatus: "created" };
    if (gelato.createMode === "timeout-after-create") {
      gelato.createdOrders.push(created);
      const e = new Error("timeout");
      e.name = "TimeoutError";
      throw e;
    }
    if (gelato.createMode === "reject") return json(400, { message: "Invalid file" });
    gelato.createdOrders.push(created);
    return json(200, created);
  }
  if (u.pathname === "/v4/orders:search") return json(200, { orders: gelato.createdOrders.filter((o) => o.orderReferenceId === body.orderReferenceId) });
  const order = u.pathname.match(/^\/v4\/orders\/([^/:]+)$/);
  if (order) return json(200, { id: order[1], fulfillmentStatus: gelato.remoteStatus, shipment: { shipmentMethodName: "UPS Ground", packages: gelato.remoteStatus === "shipped" ? [{ trackingCode: "1ZTEST", trackingUrl: "https://ups.example/1ZTEST" }] : [] } });
  return json(404, { message: "not found" });
}

// ---------- Module loader with substitutions for external services ----------
const cache = new Map();
const mails = [];
const pendingAfter = [];
const overrides = {
  "lib/db.ts": { getPool: () => pool, databaseConfigured: () => true },
  "lib/platform-settings.ts": { integrationValue: async (k) => secrets[k] || "", sealSecret: (v) => "sealed:" + v, unsealSecret: (v) => v.replace(/^sealed:/, "") },
  "lib/billing.ts": { stripeClient: async () => stripeStub },
  "lib/admin.ts": { adminAccess: async () => null, canAccess: () => false, platformRole: async () => "member" },
  "next/server": { after: (fn) => pendingAfter.push(fn), NextRequest: Request },
  "next/headers": { cookies: async () => ({ get: () => undefined, set() {} }), headers: async () => new Headers() },
  "lib/auth.ts": { getAuth: () => ({ api: { getSession: async () => null } }) },
  "lib/mail.ts": { sendAccountMail: async (to, subject, url) => mails.push({ to, subject, url }) },
};
function load(abs) {
  if (cache.has(abs)) return cache.get(abs).exports;
  const m = new Module(abs);
  cache.set(abs, m);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  const std = m.require.bind(m);
  m.require = (id) => {
    if (overrides[id]) return overrides[id];
    let target = id.startsWith("@/") ? path.resolve("src", id.slice(2)) : id.startsWith(".") ? path.resolve(path.dirname(abs), id) : null;
    if (target) {
      for (const ext of [".ts", ".tsx", ".mjs", ""]) {
        const file = target + ext;
        if (fs.existsSync(file) && fs.statSync(file).isFile()) {
          const key = path.relative(path.resolve("src"), file).replaceAll(path.sep, "/");
          if (overrides[key]) return overrides[key];
          return file.endsWith(".mjs") ? std(file) : load(file);
        }
      }
    }
    return std(id);
  };
  m._compile(ts.transpileModule(fs.readFileSync(abs, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText, abs);
  return m.exports;
}
const src = (p) => load(path.resolve("src", p));
const client = src("lib/gelato/client.ts");
client.setGelatoTransport(transport);
const catalog = src("lib/gelato/catalog.ts");
const studio = src("lib/studio/service.ts");
const market = src("lib/marketplace.ts");
const fulfillment = src("lib/gelato/fulfillment.ts");
const notifications = src("lib/gelato/notifications.ts");
const orders = src("lib/gelato/orders.ts");
const marketMail = src("lib/market-mail.ts");
const stripeWebhook = src("app/api/marketplace/webhook/route.ts");
const gelatoWebhook = src("app/api/marketplace/gelato/webhook/route.ts");
const printFiles = src("app/api/marketplace/print-files/route.ts");
const alerts = [];
notifications.setAdminAlertMailer(async (m) => alerts.push(m));
// Resend is the only other external host; capture what would be sent.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.resend.com/")) {
    mails.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "email_" + mails.length }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return realFetch(url, init);
};

const passed = [];
const step = async (name, fn) => {
  await fn();
  passed.push(name);
};
async function webhookEvent(type, object, id) {
  const payload = JSON.stringify({ id, object: "event", type, data: { object } });
  const signature = realStripe.webhooks.generateTestHeaderString({ payload, secret: secrets.STRIPE_MARKETPLACE_WEBHOOK_SECRET });
  return stripeWebhook.POST(new Request("https://shop.test.example/api/marketplace/webhook", { method: "POST", headers: { "stripe-signature": signature }, body: payload }));
}
const address = { name: "Ada Lovelace", line1: "1 Congress Ave", city: "Austin", state: "TX", postalCode: "78701", phone: "+1 512 555 0100" };

try {
  const actor = randomUUID(), other = randomUUID();
  const tag = Date.now().toString(36);
  await pool.query('INSERT INTO public."user"(id,name,email) VALUES($1,$2,$3),($4,$5,$6)', [actor, "Buyer One", `buyer-${tag}@example.com`, other, "Other Buyer", `other-${tag}@example.com`]);
  await pool.query("UPDATE private.platform_settings SET value=value||'{\"checkoutEnabled\":true,\"guestCheckoutEnabled\":true}'::jsonb WHERE key='marketplace'");
  const buyer = { userId: actor, guestHash: null };
  const intruder = { userId: other, guestHash: null };
  const guest = { userId: null, guestHash: "a".repeat(64) };

  await step("invalid credentials never report Connected and never log the key", async () => {
    await assert.rejects(catalog.testGelatoConnection(actor), (e) => e.status === 424);
    const i = await catalog.gelatoIntegration();
    assert.equal(i.status, "invalid_credentials");
    assert.equal(i.last_success_at, null);
    const logged = JSON.stringify((await pool.query("SELECT * FROM private.supplier_api_errors")).rows);
    assert(logged.includes("invalid_credentials") && !logged.includes("bad-key"));
  });

  secrets.GELATO_API_KEY = "gelato-valid-key-for-tests";
  await step("a real authenticated catalog read marks the connection healthy", async () => {
    assert.deepEqual(await catalog.testGelatoConnection(actor), { ok: true, catalogs: 1 });
    assert.equal((await catalog.gelatoIntegration()).status, "connected");
    assert.equal((await pool.query("SELECT count(*)::int n FROM private.supplier_products")).rows[0].n, 0, "connecting never imports products");
  });

  let spId, productId, variants;
  await step("only explicitly selected products import, as unpublished drafts, without duplicates", async () => {
    const found = await catalog.searchCatalog("t-shirts", {}, 0);
    assert.equal(found.products.length, 2);
    const r = await catalog.importProducts(actor, { catalogUid: "t-shirts", productUids: found.products.map((p) => p.productUid), title: "Classic tee", category: "T-shirts", mode: "group" });
    productId = r.products[0];
    const p = (await pool.query("SELECT status,cost_cents,price_cents FROM private.marketplace_products WHERE id=$1", [productId])).rows[0];
    assert.equal(p.status, "draft");
    assert.equal(p.cost_cents, 850);
    assert(p.price_cents > 850);
    await assert.rejects(catalog.importProducts(actor, { catalogUid: "t-shirts", productUids: [found.products[0].productUid], mode: "separate" }), (e) => e.status === 409);
    assert.equal((await catalog.searchCatalog("t-shirts", {}, 0)).products.filter((x) => x.imported).length, 2);
    spId = (await pool.query("SELECT id FROM private.supplier_products WHERE product_id=$1", [productId])).rows[0].id;
    variants = (await pool.query("SELECT id,supplier_uid,price_tiers FROM private.supplier_variants WHERE supplier_product_id=$1 ORDER BY supplier_uid", [spId])).rows;
    assert.equal(variants.length, 2);
    assert.equal(variants[0].price_tiers.length, 2);
  });

  await step("refresh updates supplier data but never admin-managed listing fields", async () => {
    await pool.query("UPDATE private.marketplace_products SET title='Premium Zenvio Tee',description='Soft ringspun cotton tee printed on demand.' WHERE id=$1", [productId]);
    await pool.query(
      "UPDATE private.supplier_products SET print_areas=$2 WHERE id=$1",
      [spId, JSON.stringify([{ key: "front", label: "Front", file_type: "default", width_mm: 254, height_mm: 305, bleed_mm: 0, safe_mm: 5, min_dpi: 150 }])],
    );
    const r = await catalog.refreshProduct(spId, actor);
    assert.equal(r.failed, 0);
    const p = (await pool.query("SELECT title,description FROM private.marketplace_products WHERE id=$1", [productId])).rows[0];
    assert.equal(p.title, "Premium Zenvio Tee");
    await pool.query("UPDATE private.marketplace_products SET status='active' WHERE id=$1", [productId]);
    await pool.query("UPDATE private.supplier_integrations SET enabled=true,fulfillment_enabled=true WHERE provider='gelato'");
    await pool.query("UPDATE private.marketplace_suppliers SET active=true WHERE connector='gelato'");
  });

  let asset, design;
  await step("Brand Studio stores private artwork and enforces ownership", async () => {
    const logo = await sharp({ create: { width: 3000, height: 1500, channels: 4, background: { r: 54, g: 92, b: 255, alpha: 0.9 } } }).png().toBuffer();
    asset = await studio.uploadAsset(buyer, logo, "logo.png");
    assert.equal(asset.has_alpha, true);
    await assert.rejects(studio.assetImage(intruder, asset.id), (e) => e.status === 404);
    await assert.rejects(studio.uploadAsset(buyer, Buffer.from("<svg><script>1</script></svg>"), "x.svg"), /scripts/);
    design = await studio.saveDesign(buyer, { productId, variantId: variants[0].id, name: "Team tee", config: { areas: { front: [{ type: "image", assetId: asset.id, x: 0.5, y: 0.35, w: 0.7 }, { type: "text", text: "ZENVIO CREW", font: "sans-bold", color: "#151b38", size: 0.08, x: 0.5, y: 0.75 }] } } });
    assert.equal(design.status, "draft");
    assert(design.validation.ok);
    await assert.rejects(studio.getDesign(intruder, design.id), (e) => e.status === 404);
    await assert.rejects(studio.saveDesign(intruder, { productId, variantId: variants[0].id, config: { areas: { front: [{ type: "image", assetId: asset.id, x: 0.5, y: 0.5, w: 0.5 }] } } }).then((d) => studio.approveDesign(intruder, d.id, d.revision)), (e) => e.status === 422, "another user's artwork cannot be used");
  });

  await step("unapproved designs cannot be ordered; approval renders production PDFs for the revision", async () => {
    await assert.rejects(market.createMarketCheckout({ lines: [{ productId, variantId: variants[0].id, designId: design.id, quantity: 2 }], shippingAddress: address }, { id: actor, email: `buyer-${tag}@example.com`, name: "Buyer One" }, "https://shop.test.example"), (e) => e.status === 409 && /Approve/.test(e.message));
    await assert.rejects(studio.approveDesign(buyer, design.id, design.revision + 1), (e) => e.status === 409);
    design = await studio.approveDesign(buyer, design.id, design.revision);
    assert.equal(design.status, "approved");
    assert.equal(design.proofs.length, 1);
    const file = (await studio.proofFile(buyer, design.proofs[0].id)).file;
    assert.equal(file.subarray(0, 5).toString(), "%PDF-");
    await assert.rejects(studio.proofFile(intruder, design.proofs[0].id), (e) => e.status === 404);
  });

  let orderId;
  await step("checkout prices from the database and a live quote; client prices are ignored", async () => {
    const r = await market.createMarketCheckout({ lines: [{ productId, variantId: variants[0].id, designId: design.id, quantity: 2, price: 1 }], shippingAddress: address }, { id: actor, email: `buyer-${tag}@example.com`, name: "Buyer One" }, "https://shop.test.example");
    orderId = r.orderId;
    const s = sessions.at(-1).input;
    const item = (await pool.query("SELECT price_cents,cost_cents,supplier_variant_uid,design_id,print_files FROM private.marketplace_order_items WHERE order_id=$1", [orderId])).rows[0];
    assert.equal(s.line_items[0].price_data.unit_amount, item.price_cents);
    assert(item.price_cents > 900);
    assert.equal(item.cost_cents, 900, "unit cost snapshot from the live quote");
    assert.equal(item.supplier_variant_uid, variants[0].supplier_uid);
    assert.equal(item.print_files[0].fileType, "default");
    assert.equal(s.shipping_options[0].shipping_rate_data.fixed_amount.amount, 525);
    assert.equal(s.shipping_address_collection, undefined, "address was collected and quoted before payment");
    const so = (await pool.query("SELECT status,reference_id,shipment_method_uid FROM private.supplier_orders WHERE order_id=$1", [orderId])).rows[0];
    assert.equal(so.status, "pending");
    assert.equal(so.reference_id, `zenvio-${orderId}`);
    assert.equal(so.shipment_method_uid, "normal");
    const quote = calls.filter((c) => c.path === "/v4/orders:quote").at(-1).body;
    assert(quote.products[0].files[0].url.startsWith("https://shop.test.example/api/marketplace/print-files?"));
  });

  await step("a supplier order is never submitted before verified payment", async () => {
    const r = await fulfillment.processSupplierOrders(5);
    assert.equal(calls.filter((c) => c.path === "/v4/orders" && c.method === "POST").length, 0);
    assert.equal(r.submitted, undefined);
  });

  await step("verified, duplicate-safe payment webhooks release the order and queue one confirmation", async () => {
    const s = { ...sessions.at(-1).session, status: "complete", payment_status: "paid", payment_intent: "pi_gel_1" };
    const forged = await stripeWebhook.POST(new Request("https://shop.test.example/api/marketplace/webhook", { method: "POST", body: JSON.stringify({ id: "evt_x", type: "checkout.session.completed", data: { object: s } }) }));
    assert.equal(forged.status, 400);
    gelato.createMode = "timeout-after-create";
    for (let i = 0; i < 2; i++) assert.equal((await webhookEvent("checkout.session.completed", s, "evt_gel_paid")).status, 200);
    const o = (await pool.query("SELECT payment_status,shipping_address FROM private.marketplace_orders WHERE id=$1", [orderId])).rows[0];
    assert.equal(o.payment_status, "paid");
    assert.equal(o.shipping_address.address.postal_code, "78701", "pre-collected address is preserved");
    assert.equal((await pool.query("SELECT status FROM private.supplier_orders WHERE order_id=$1", [orderId])).rows[0].status, "ready");
    assert.equal((await pool.query("SELECT count(*)::int n FROM private.marketplace_order_emails WHERE order_id=$1 AND kind='confirmation'", [orderId])).rows[0].n, 1);
  });

  let soId;
  await step("an uncertain submission is looked up by reference and never blindly resubmitted", async () => {
    soId = (await pool.query("SELECT id FROM private.supplier_orders WHERE order_id=$1", [orderId])).rows[0].id;
    for (const fn of pendingAfter.splice(0)) await fn();
    let row = (await pool.query("SELECT status,attempts FROM private.supplier_orders WHERE id=$1", [soId])).rows[0];
    assert.equal(row.status, "uncertain");
    assert.equal(calls.filter((c) => c.path === "/v4/orders" && c.method === "POST").length, 1);
    await pool.query("UPDATE private.supplier_orders SET next_attempt_at=now() WHERE id=$1", [soId]);
    gelato.createMode = "ok";
    await fulfillment.processSupplierOrders(5);
    row = (await pool.query("SELECT status,supplier_order_id FROM private.supplier_orders WHERE id=$1", [soId])).rows[0];
    // The same background pass also syncs it; the mock reports "printed".
    assert(["submitted", "in_production"].includes(row.status), row.status);
    assert.equal(row.supplier_order_id, "gel-1");
    assert.equal(calls.filter((c) => c.path === "/v4/orders" && c.method === "POST").length, 1, "exactly one create call");
    assert.equal(gelato.createdOrders.length, 1);
    const payload = calls.find((c) => c.path === "/v4/orders" && c.method === "POST").body;
    assert.equal(payload.orderReferenceId, `zenvio-${orderId}`);
    assert.equal(payload.shippingAddress.state, "TX");
  });

  await step("signed print-file URLs serve the approved PDF to the supplier only", async () => {
    const payload = calls.find((c) => c.path === "/v4/orders" && c.method === "POST").body;
    const url = new URL(payload.items[0].files[0].url);
    const ok = await printFiles.GET({ nextUrl: url });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "application/pdf");
    url.searchParams.set("sig", "A".repeat(43));
    assert.equal((await printFiles.GET({ nextUrl: url })).status, 403);
  });

  await step("status sync records tracking, updates the order and notifies once", async () => {
    gelato.remoteStatus = "shipped";
    await fulfillment.syncSupplierOrder(soId);
    await fulfillment.syncSupplierOrder(soId);
    const o = (await pool.query("SELECT status,tracking_number,tracking_url,carrier FROM private.marketplace_orders WHERE id=$1", [orderId])).rows[0];
    assert.deepEqual(o, { status: "shipped", tracking_number: "1ZTEST", tracking_url: "https://ups.example/1ZTEST", carrier: "UPS Ground" });
    assert.equal((await pool.query("SELECT count(*)::int n FROM private.marketplace_order_emails WHERE order_id=$1 AND kind='shipped'", [orderId])).rows[0].n, 1);
  });

  await step("Gelato webhooks require the secret URL token, re-fetch state and deduplicate", async () => {
    const send = (token, body) => gelatoWebhook.POST({ nextUrl: new URL(`https://shop.test.example/api/marketplace/gelato/webhook?token=${token}`), headers: new Headers(), text: async () => JSON.stringify(body) });
    assert.equal((await send("x".repeat(43), { orderId: "gel-1" })).status, 401);
    const token = "T".repeat(43);
    await pool.query("UPDATE private.supplier_integrations SET webhook_token_hash=encode(sha256($1::bytea),'hex') WHERE provider='gelato'", [token]);
    assert.equal((await send("U".repeat(43), { orderId: "gel-1" })).status, 401);
    gelato.remoteStatus = "delivered";
    // The payload claims "canceled" but the API says delivered: the API wins.
    const r = await send(token, { id: "wh-1", event: "order_status_updated", orderId: "gel-1", fulfillmentStatus: "canceled" });
    assert.deepEqual(await r.json(), { received: true });
    assert.deepEqual(await (await send(token, { id: "wh-1", event: "order_status_updated", orderId: "gel-1" })).json(), { duplicate: true });
    assert.equal((await pool.query("SELECT status FROM private.supplier_orders WHERE id=$1", [soId])).rows[0].status, "delivered");
  });

  await step("customer views hide supplier costs and identifiers", async () => {
    const view = await orders.customerOrder(orderId, actor);
    const text = JSON.stringify(view);
    assert(!text.includes("cost_cents") && !text.includes("gel-1") && !text.includes("supplier_variant_uid"));
    assert.equal(view.fulfillment.label, "Delivered");
    assert.equal(view.fulfillment.shipments[0].tracking_code, "1ZTEST");
    await assert.rejects(orders.customerOrder(orderId, other), (e) => e.status === 404);
  });

  await step("emails are delivered once each and never contain supplier costs", async () => {
    secrets.RESEND_API_KEY = "re_isolated";
    secrets.AUTH_EMAIL_FROM = "Zenvio <orders@example.com>";
    const r = await marketMail.deliverMarketEmails(50);
    assert(r.sent >= 3);
    assert.equal((await marketMail.deliverMarketEmails(50)).sent, 0);
    const kinds = mails.map((m) => m.subject);
    assert(kinds.some((s) => / confirmed$/.test(s)) && kinds.some((s) => / has shipped$/.test(s)) && kinds.some((s) => / is in production$/.test(s)), kinds.join(" | "));
    for (const m of mails) assert(!/\b9\.00\b|cost/i.test(m.text || ""));
  });

  await step("rising supplier costs pause fixed-price products, alert admins and block checkout", async () => {
    // An admin-fixed retail price that no longer covers cost must pause purchasing.
    const current = (await pool.query("SELECT price_cents FROM private.marketplace_order_items WHERE order_id=$1", [orderId])).rows[0].price_cents;
    await pool.query("UPDATE private.supplier_variants SET retail_cents=$2 WHERE id=$1", [variants[0].id, current]);
    gelato.quoteUnitCost = "40.00";
    await assert.rejects(market.createMarketCheckout({ lines: [{ productId, variantId: variants[0].id, designId: design.id, quantity: 1 }], shippingAddress: address }, { id: actor, email: `buyer-${tag}@example.com`, name: "Buyer One" }, "https://shop.test.example"), (e) => e.status === 409 && /pricing has changed/.test(e.message));
    const sp = (await pool.query("SELECT purchasing_paused,paused_reason FROM private.supplier_products WHERE id=$1", [spId])).rows[0];
    assert.equal(sp.purchasing_paused, true);
    assert((await pool.query("SELECT count(*)::int n FROM private.marketplace_admin_alerts")).rows[0].n >= 1);
    await assert.rejects(market.createMarketCheckout({ lines: [{ productId, variantId: variants[0].id, designId: design.id, quantity: 1 }], shippingAddress: address }, { id: actor, email: `buyer-${tag}@example.com`, name: "Buyer One" }, "https://shop.test.example"), (e) => e.status === 409);
    gelato.quoteUnitCost = "9.00";
    await pool.query("UPDATE private.supplier_variants SET retail_cents=NULL WHERE id=$1", [variants[0].id]);
    await catalog.refreshProduct(spId, actor);
    await pool.query("UPDATE private.supplier_products SET purchasing_paused=false,paused_reason=NULL WHERE id=$1", [spId]);
  });

  await step("guest checkout uses private fragment tokens (hash stored) and refund-before-submission cancels fulfillment", async () => {
    const logo = await sharp({ create: { width: 2400, height: 2400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const gAsset = await studio.uploadAsset(guest, logo, "g.png");
    let gDesign = await studio.saveDesign(guest, { productId, variantId: variants[1].id, config: { areas: { front: [{ type: "image", assetId: gAsset.id, x: 0.5, y: 0.5, w: 0.6 }] } } });
    gDesign = await studio.approveDesign(guest, gDesign.id, gDesign.revision);
    await assert.rejects(studio.getDesign(buyer, gDesign.id), (e) => e.status === 404);
    // Guests may use their own design for a different size of the same product.
    const r = await market.createMarketCheckout({ lines: [{ productId, variantId: variants[0].id, designId: gDesign.id, quantity: 1 }], shippingAddress: address }, { id: null, email: "guest@example.com", name: "Ada Lovelace", guestHash: guest.guestHash }, "https://shop.test.example");
    assert.equal(r.guest, true);
    // Main's guest model: the private token travels only in the URL fragment.
    const success = new URL(sessions.at(-1).input.success_url);
    assert.equal(success.pathname, "/marketplace/order");
    const guestToken = success.hash.slice(1);
    assert.match(guestToken, /^[A-Za-z0-9_-]{43}$/);
    const stored = (await pool.query("SELECT guest_token_hash,guest_token_sealed,user_id FROM private.marketplace_orders WHERE id=$1", [r.orderId])).rows[0];
    assert.equal(stored.user_id, null);
    assert.notEqual(stored.guest_token_hash, guestToken, "only the token hash is stored for lookup");
    assert.equal(await orders.guestOrderId(guestToken), r.orderId);
    const view = await orders.customerOrder(r.orderId);
    assert(view.guest);
    await assert.rejects(orders.guestOrderId("Z".repeat(43)), (e) => e.status === 404);
    const s = { ...sessions.at(-1).session, status: "complete", payment_status: "paid", payment_intent: "pi_gel_guest" };
    await pool.query("UPDATE private.supplier_integrations SET fulfillment_paused=true WHERE provider='gelato'");
    assert.equal((await webhookEvent("checkout.session.completed", s, "evt_gel_guest_paid")).status, 200);
    for (const fn of pendingAfter.splice(0)) await fn();
    const held = (await pool.query("SELECT status FROM private.supplier_orders WHERE order_id=$1", [r.orderId])).rows[0];
    assert.equal(held.status, "ready", "paused fulfillment holds paid orders");
    const refund = { id: "ch_1", object: "charge", payment_intent: "pi_gel_guest", currency: "usd", amount_refunded: s.amount_total };
    assert.equal((await webhookEvent("charge.refunded", refund, "evt_refund_1")).status, 200);
    assert.equal((await pool.query("SELECT status FROM private.supplier_orders WHERE order_id=$1", [r.orderId])).rows[0].status, "cancelled");
    await pool.query("UPDATE private.supplier_integrations SET fulfillment_paused=false WHERE provider='gelato'");
    const before = gelato.createdOrders.length;
    await fulfillment.processSupplierOrders(5);
    assert.equal(gelato.createdOrders.length, before, "refunded order was never submitted");
    assert.equal((await pool.query("SELECT count(*)::int n FROM private.marketplace_order_emails WHERE order_id=$1 AND kind='refunded'", [r.orderId])).rows[0].n, 1);
    const sent = [];
    await orders.requestGuestLink("guest@example.com", view.order_number, async (to, url) => sent.push({ to, url }));
    await orders.requestGuestLink("guest@example.com", "ZV-0000000000", async (to, url) => sent.push({ to, url }));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, `https://shop.test.example/marketplace/order#${guestToken}`);
  });

  await step("a supplier rejection goes to the manual review queue with an admin alert", async () => {
    let d2 = await studio.saveDesign(buyer, { productId, variantId: variants[1].id, config: { areas: { front: [{ type: "text", text: "Hello", font: "serif", color: "#000000", size: 0.1, x: 0.5, y: 0.5 }] } } });
    d2 = await studio.approveDesign(buyer, d2.id, d2.revision);
    const r = await market.createMarketCheckout({ lines: [{ productId, variantId: variants[1].id, designId: d2.id, quantity: 1 }], shippingAddress: address }, { id: actor, email: `buyer-${tag}@example.com`, name: "Buyer One" }, "https://shop.test.example");
    gelato.createMode = "reject";
    const s = { ...sessions.at(-1).session, status: "complete", payment_status: "paid", payment_intent: "pi_gel_3" };
    await webhookEvent("checkout.session.completed", s, "evt_gel_3");
    for (const fn of pendingAfter.splice(0)) await fn();
    const row = (await pool.query("SELECT id,status,last_error FROM private.supplier_orders WHERE order_id=$1", [r.orderId])).rows[0];
    assert.equal(row.status, "needs_review");
    assert.match(row.last_error, /Invalid file/);
    gelato.createMode = "ok";
    await assert.rejects(fulfillment.retrySupplierOrder(row.id, actor).then(() => fulfillment.retrySupplierOrder(row.id, actor)), (e) => e.status === 409, "an order created at Gelato cannot be retried again");
    assert.equal((await pool.query("SELECT status FROM private.supplier_orders WHERE id=$1", [row.id])).rows[0].status, "submitted");
  });

  console.log(`PASS (${passed.length} scenarios):\n- ${passed.join("\n- ")}`);
} finally {
  await pool.query("UPDATE private.platform_settings SET value=value||'{\"checkoutEnabled\":false,\"guestCheckoutEnabled\":false}'::jsonb WHERE key='marketplace'").catch(() => {});
  client.setGelatoTransport(null);
  globalThis.fetch = realFetch;
  await pool.end();
}
