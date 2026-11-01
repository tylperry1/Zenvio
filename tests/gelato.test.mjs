// Gelato integration, pricing guards and Brand Studio: pure logic and real
// sharp/pdf-lib processing. No network or database.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import test from "node:test";
import ts from "typescript";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";

function load(file, overrides = {}) {
  const filename = path.resolve(file), m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const req = m.require.bind(m);
  m.require = (id) => (Object.hasOwn(overrides, id) ? overrides[id] : req(id));
  m._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
  return m.exports;
}
const G = load("src/lib/gelato/core.ts");
const P = load("src/lib/market-pricing.ts");
const D = load("src/lib/studio/design.ts");
const F = load("src/lib/studio/print-file.ts", { "./design": D });
process.env.INTEGRATION_ENCRYPTION_KEY = "unit-test-signing-secret-1234567890";
const A = load("src/lib/studio/assets.ts");

test("Gelato endpoints use documented hosts, versions and encode identifiers", () => {
  assert.equal(G.GELATO_HOSTS.product, "https://product.gelatoapis.com");
  assert.equal(G.GELATO_HOSTS.order, "https://order.gelatoapis.com");
  assert.equal(G.GELATO_ENDPOINTS.catalogs(), "/v3/catalogs");
  assert.equal(G.GELATO_ENDPOINTS.searchProducts("t-shirts"), "/v3/catalogs/t-shirts/products:search");
  assert.equal(G.GELATO_ENDPOINTS.prices("a/b", "US", "USD"), "/v3/products/a%2Fb/prices?country=US&currency=USD");
  assert.equal(G.GELATO_ENDPOINTS.orders(), "/v4/orders");
  assert.equal(G.GELATO_ENDPOINTS.quote(), "/v4/orders:quote");
  assert.equal(G.GELATO_ENDPOINTS.cancelOrder("x"), "/v4/orders/x:cancel");
});

test("HTTP failures are classified without leaking credentials", () => {
  assert.equal(G.classifyHttpFailure(401, {}, null).category, "invalid_credentials");
  assert.equal(G.classifyHttpFailure(403, {}, null).category, "invalid_credentials");
  const limited = G.classifyHttpFailure(429, {}, "30");
  assert.equal(limited.category, "rate_limited");
  assert.equal(limited.retryAfterSeconds, 30);
  assert(limited.uncertain);
  assert.equal(G.classifyHttpFailure(503, {}, null).category, "unavailable");
  const rejected = G.classifyHttpFailure(400, { message: "Bad key X-API-KEY: abcdef0123456789abcdef0123456789abcd" }, null);
  assert.equal(rejected.category, "rejected");
  assert(!rejected.uncertain);
  assert(!rejected.message.includes("abcdef0123456789"));
});

test("money parsing is decimal-safe and rejects garbage", () => {
  assert.equal(G.toCents("12.34"), 1234);
  assert.equal(G.toCents(0.1 + 0.2), 30);
  assert.equal(G.toCents("9.995"), 1000);
  assert.equal(G.toCents("9.994"), 999);
  assert.equal(G.toCents(7), 700);
  assert.equal(G.toCents("-1"), null);
  assert.equal(G.toCents("1e3"), null);
  assert.equal(G.toCents(null), null);
});

test("catalog and product responses are normalized; malformed data is dropped, not invented", () => {
  assert.deepEqual(G.parseCatalogs([{ catalogUid: "mugs", title: "Mugs" }, { bad: 1 }]), [{ uid: "mugs", title: "Mugs" }]);
  assert.deepEqual(G.parseCatalogs({ data: [{ catalogUid: "posters" }] }), [{ uid: "posters", title: "posters" }]);
  assert.throws(() => G.parseCatalogs({ nope: true }), (e) => e.category === "invalid_response");
  const p = G.parseProduct({
    productUid: "apparel_product_gca_t-shirt_gsi_m_gco_white",
    attributes: { GarmentSize: "M", GarmentColor: "white", Other: 5 },
    weight: { value: 0.2, measureUnit: "kg" },
    dimensions: { Width: { value: 300, measureUnit: "mm" }, Height: { value: 400, measureUnit: "mm" } },
    supportedCountries: ["US", "GB"],
  });
  assert.equal(p.size, "M");
  assert.equal(p.color, "White");
  assert.equal(p.weightGrams, 200);
  assert.equal(p.supportedInUS, true);
  assert.equal(p.attributes.Other, undefined);
  assert.deepEqual(G.printAreaFromDimensions(p.dimensions).width_mm, 300);
  assert.equal(G.printAreaFromDimensions({}), null);
  const search = G.parseProductSearch({ products: [{ productUid: "a" }, { nope: 1 }] });
  assert.equal(search.products.length, 1);
});

test("price tiers keep the requested currency and derive per-unit cost", () => {
  const tiers = G.parsePrices([
    { quantity: 1, price: 12.5, currency: "USD" },
    { quantity: 10, price: "100.00", currency: "USD" },
    { quantity: 1, price: 9, currency: "EUR" },
  ]);
  assert.deepEqual(tiers, [{ quantity: 1, cost_cents: 1250 }, { quantity: 10, cost_cents: 10000 }]);
  assert.equal(G.unitCostAt(tiers, 1), 1250);
  assert.equal(G.unitCostAt(tiers, 25), 1000);
  assert.equal(G.unitCostAt([], 1), null);
});

test("status mapping moves forward only and surfaces exceptions", () => {
  assert.equal(G.mapFulfillmentStatus("created"), "submitted");
  assert.equal(G.mapFulfillmentStatus("passed"), "accepted");
  assert.equal(G.mapFulfillmentStatus("printed"), "in_production");
  assert.equal(G.mapFulfillmentStatus("in_transit"), "shipped");
  assert.equal(G.mapFulfillmentStatus("delivered"), "delivered");
  assert.equal(G.mapFulfillmentStatus("canceled"), "cancelled");
  assert.equal(G.mapFulfillmentStatus("on_hold"), "needs_review");
  assert.equal(G.mapFulfillmentStatus("something_new"), null);
  assert.equal(G.nextStatus("shipped", "accepted"), "shipped");
  assert.equal(G.nextStatus("accepted", "shipped"), "shipped");
  assert.equal(G.nextStatus("shipped", "failed"), "failed");
  assert.equal(G.nextStatus("in_production", null), "in_production");
});

test("tracking is collected from packages and item fulfillments with HTTPS links only", () => {
  const s = G.parseShipments({
    shipment: { shipmentMethodName: "UPS Ground", packages: [{ trackingCode: "1Z1", trackingUrl: "https://ups.example/1Z1" }] },
    items: [{ fulfillments: [{ trackingCode: "1Z1" }, { trackingCode: "9400", trackingUrl: "javascript:alert(1)", shipmentMethodName: "USPS" }] }],
  });
  assert.equal(s.length, 2);
  assert.equal(s.find((x) => x.trackingCode === "9400").trackingUrl, "");
  assert.equal(s.find((x) => x.trackingCode === "1Z1").carrier, "UPS Ground");
});

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", state: "TX", postalCode: "78701", country: "US", email: "ada@example.com" };
test("order payloads carry the idempotent reference and refuse non-HTTPS files", () => {
  const payload = G.buildOrderPayload({
    referenceId: "zenvio-123",
    customerReferenceId: "user-1",
    address,
    items: [{ itemReferenceId: "i1", productUid: "uid", quantity: 2, files: [{ type: "default", url: "https://gozenvio.com/f" }] }],
    shipmentMethodUid: "standard",
  });
  assert.equal(payload.orderReferenceId, "zenvio-123");
  assert.equal(payload.orderType, "order");
  assert.equal(payload.shippingAddress.firstName, "Ada");
  assert.equal(payload.shippingAddress.postCode, "78701");
  assert.equal(payload.shipmentMethodUid, "standard");
  assert.throws(() => G.buildOrderPayload({ referenceId: "r", customerReferenceId: "c", address, items: [{ itemReferenceId: "i", productUid: "u", quantity: 1, files: [{ type: "default", url: "http://x" }] }] }));
  assert.throws(() => G.buildOrderPayload({ referenceId: "r", customerReferenceId: "c", address, items: [] }));
});

test("quotes choose the cheapest shipping and reject split or foreign-currency quotes", () => {
  const q = G.parseQuote({
    quotes: [
      {
        products: [{ itemReferenceId: "line-1", quantity: 3, price: "30.00", currency: "USD" }],
        shipmentMethods: [
          { shipmentMethodUid: "express", name: "Express", price: 20, currency: "USD", minDeliveryDays: 1, maxDeliveryDays: 2 },
          { shipmentMethodUid: "normal", name: "Standard", price: "6.50", currency: "USD", minDeliveryDays: 3, maxDeliveryDays: 5 },
        ],
      },
    ],
  });
  assert.deepEqual(q.items, [{ itemReferenceId: "line-1", unitCostCents: 1000, totalCents: 3000 }]);
  assert.equal(q.shipping.uid, "normal");
  assert.equal(q.shipping.costCents, 650);
  assert.throws(() => G.parseQuote({ quotes: [{}, {}] }), (e) => e.category === "rejected");
  assert.throws(() => G.parseQuote({ quotes: [{ products: [{ itemReferenceId: "a", quantity: 1, price: 1, currency: "EUR" }] }] }));
  assert.throws(() => G.parseQuote({}), (e) => e.category === "invalid_response");
});

test("order search matches only our exact reference", () => {
  assert.deepEqual(G.findOrderByReference({ orders: [{ id: "g1", orderReferenceId: "zenvio-1", fulfillmentStatus: "created" }] }, "zenvio-1"), { id: "g1", fulfillmentStatus: "created" });
  assert.equal(G.findOrderByReference({ orders: [{ id: "g1", orderReferenceId: "zenvio-10" }] }, "zenvio-1"), null);
  assert.throws(() => G.findOrderByReference({}, "x"));
  assert.equal(G.parseWebhook({ foo: 1 }), null);
  assert.equal(G.parseWebhook({ id: "e1", event: "order_status_updated", orderId: "g1" }).orderId, "g1");
});

test("supplier retail pricing enforces markup, minimum profit, minimum margin and minimum retail", () => {
  const rule = P.effectiveRule({ markup_bps: 5000, min_profit_cents: 300, min_margin_bps: 3000 }, { min_retail_cents: 2500 });
  const price = P.supplierRetailPrice({ unitCostCents: 1000 }, rule);
  assert(price >= 2500);
  assert.equal(P.profitViolation(price, { unitCostCents: 1000 }, rule), null);
  assert.match(P.profitViolation(1100, { unitCostCents: 1000 }, rule), /minimum|Margin|Profit/);
  assert.match(P.profitViolation(900, { unitCostCents: 1000 }, rule), /below landed cost/);
  // Sweep: the engine never produces a price that fails its own guards.
  for (const cost of [1, 99, 450, 1234, 9999, 55555])
    for (const qty of [1, 5, 50])
      for (const margin of [0, 2000, 4500]) {
        const r = P.effectiveRule({ markup_bps: 4000, min_profit_cents: 200, min_margin_bps: margin });
        const p = P.supplierRetailPrice({ unitCostCents: cost, quantity: qty }, r);
        assert.equal(P.profitViolation(p, { unitCostCents: cost, quantity: qty }, r), null, `cost ${cost} qty ${qty} margin ${margin}`);
      }
  // Product overrides win over rules; null keeps the rule.
  assert.equal(P.effectiveRule({ markup_bps: 5000, min_profit_cents: 1 }, { markup_bps: 9000, min_profit_cents: null }).markup_bps, 9000);
  assert.equal(P.effectiveRule({ markup_bps: 5000, min_profit_cents: 1 }, { min_profit_cents: null }).min_profit_cents, 1);
});

const areas = D.parsePrintAreas([{ key: "front", label: "Front", file_type: "default", width_mm: 254, height_mm: 305, bleed_mm: 0, safe_mm: 5, min_dpi: 150 }]);
const asset = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", width: 3000, height: 3000, has_alpha: true };
test("print areas and designs are strictly validated", () => {
  assert.throws(() => D.parsePrintAreas([{ key: "Front!", file_type: "default", width_mm: 10, height_mm: 10 }]));
  assert.throws(() => D.parsePrintAreas([{ key: "a", file_type: "bogus", width_mm: 10, height_mm: 10 }]));
  assert.throws(() => D.parsePrintAreas([{ key: "a", file_type: "default", width_mm: 100, height_mm: 100 }, { key: "b", file_type: "default", width_mm: 100, height_mm: 100 }]));
  assert.throws(() => D.parseDesign({ areas: { back: [] } }, areas), /print area/);
  assert.throws(() => D.parseDesign({ areas: { front: [{ type: "image", assetId: "../etc", x: 0.5, y: 0.5, w: 0.5 }] } }, areas));
  assert.throws(() => D.parseDesign({ areas: { front: [{ type: "text", text: "Hello 世界", font: "sans", color: "#000000", size: 0.1, x: 0.5, y: 0.5 }] } }, areas), /characters/);
  assert.throws(() => D.parseDesign({ areas: { front: [{ type: "text", text: "Hi", font: "comic", color: "#000000", size: 0.1, x: 0.5, y: 0.5 }] } }, areas), /font/);
  const ok = D.parseDesign({ areas: { front: [{ type: "text", text: "  Café   Zenvio ", font: "serif-bold", color: "#365CFF", size: 0.1, x: 0.5, y: 0.5 }] } }, areas);
  assert.equal(ok.areas.front[0].text, "Café Zenvio");
  assert.equal(ok.areas.front[0].color, "#365cff");
});

test("design validation enforces resolution, bounds and content", () => {
  const assets = new Map([[asset.id, asset]]);
  const good = D.parseDesign({ areas: { front: [{ type: "image", assetId: asset.id, x: 0.5, y: 0.4, w: 0.8 }] } }, areas);
  const v = D.validateDesign(good, areas, assets);
  assert(v.ok, v.errors.join());
  assert(v.areas.front.minDpi >= 300);
  const huge = D.parseDesign({ areas: { front: [{ type: "image", assetId: asset.id, x: 0.5, y: 0.5, w: 1.5 }] } }, areas);
  const small = { ...asset, width: 400, height: 400 };
  const low = D.validateDesign(huge, areas, new Map([[asset.id, small]]));
  assert(!low.ok);
  assert.match(low.errors[0], /DPI/);
  const outside = D.parseDesign({ areas: { front: [{ type: "image", assetId: asset.id, x: 1.45, y: 1.45, w: 0.05 }] } }, areas);
  assert.match(D.validateDesign(outside, areas, assets).errors.join(), /outside/);
  assert(!D.validateDesign({ areas: {} }, areas, assets).ok);
  assert.match(D.validateDesign(good, areas, new Map()).errors.join(), /missing/);
  const opaque = D.validateDesign(good, areas, new Map([[asset.id, { ...asset, has_alpha: false }]]));
  assert.match(opaque.warnings.join(), /transparent/);
});

test("print files are real PDFs at the supplier's physical size with embedded artwork and fonts", async () => {
  const png = await sharp({ create: { width: 1200, height: 600, channels: 4, background: { r: 54, g: 92, b: 255, alpha: 0.8 } } }).png().toBuffer();
  const area = D.parsePrintAreas([{ key: "front", label: "Front", file_type: "default", width_mm: 89, height_mm: 51, bleed_mm: 3, safe_mm: 3, min_dpi: 300 }])[0];
  const design = D.parseDesign(
    {
      areas: {
        front: [
          { type: "image", assetId: asset.id, x: 0.5, y: 0.4, w: 0.6 },
          { type: "text", text: "Zenvio – Café", font: "sans-bold", color: "#151b38", size: 0.12, x: 0.5, y: 0.85 },
        ],
      },
    },
    [area],
  );
  const { file, sha256 } = await F.renderPrintFile(area, design, new Map([[asset.id, { id: asset.id, width: 1200, height: 600, has_alpha: true, mime: "image/png", image: png }]]));
  assert.equal(file.subarray(0, 5).toString(), "%PDF-");
  assert.match(sha256, /^[a-f0-9]{64}$/);
  const pdf = await PDFDocument.load(file);
  const page = pdf.getPage(0);
  const mm = (pt) => Math.round((pt * 25.4) / 72);
  assert.equal(mm(page.getWidth()), 95);
  assert.equal(mm(page.getHeight()), 57);
  const trim = page.getTrimBox();
  assert.equal(mm(trim.width), 89);
});

test("SVG uploads with scripts, entities or external references are rejected", () => {
  assert.equal(A.unsafeSvgReason('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'), null);
  assert.match(A.unsafeSvgReason('<svg><script>alert(1)</script></svg>'), /scripts/);
  assert.match(A.unsafeSvgReason('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>'), /document type/);
  assert.match(A.unsafeSvgReason('<svg onload="x()"></svg>'), /event handlers/);
  assert.match(A.unsafeSvgReason('<svg><image href="https://evil.example/a.png"/></svg>'), /external/);
  assert.match(A.unsafeSvgReason('<svg><rect style="fill:url(https://e.x/a)"/></svg>'), /external/);
  assert.match(A.unsafeSvgReason("not svg"), /not an SVG/);
});

test("artwork normalization validates format, size and transparency", async () => {
  const transparent = await sharp({ create: { width: 800, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const t = await A.normalizeArtwork(transparent, "logo.png");
  assert.equal(t.mime, "image/png");
  assert.equal(t.hasAlpha, true);
  assert.equal(t.width, 800);
  const opaque = await sharp({ create: { width: 600, height: 600, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
  const o = await A.normalizeArtwork(opaque, "photo.jpg");
  assert.equal(o.mime, "image/jpeg");
  assert.equal(o.hasAlpha, false);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#365cff"/></svg>');
  const s = await A.normalizeArtwork(svg, "mark.svg");
  assert.equal(s.source, "svg");
  assert(s.width >= 3000, "vector artwork is rasterized at print resolution");
  await assert.rejects(A.normalizeArtwork(Buffer.from("GIF89a....."), "x.gif"), /PNG, JPG/);
  const tiny = await sharp({ create: { width: 50, height: 50, channels: 3, background: "#000" } }).png().toBuffer();
  await assert.rejects(A.normalizeArtwork(tiny, "tiny.png"), /at least/);
  await assert.rejects(A.normalizeArtwork(Buffer.from('<svg><script>1</script></svg>'), "bad.svg"), /scripts/);
});

test("supplier print-file URLs are signed, expiring and tamper-evident", () => {
  const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const url = new URL(A.printFileUrl("https://gozenvio.com", id, 600));
  assert.equal(url.origin, "https://gozenvio.com");
  const exp = url.searchParams.get("exp"), sig = url.searchParams.get("sig");
  assert(A.verifyPrintFile(id, exp, sig));
  assert(!A.verifyPrintFile("cccccccc-cccc-4ccc-8ccc-cccccccccccc", exp, sig));
  assert(!A.verifyPrintFile(id, String(Number(exp) + 1), sig));
  assert(!A.verifyPrintFile(id, exp, sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A")));
  const past = Math.floor(Date.now() / 1000) - 10;
  assert(!A.verifyPrintFile(id, String(past), A.signPrintFile(id, past)));
  assert(!A.verifyPrintFile(id, null, null));
});
