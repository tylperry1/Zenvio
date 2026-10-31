import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync("public/sw.js", "utf8");

// Load the worker with a fake ServiceWorkerGlobalScope and capture its fetch handler.
function worker() {
  const handlers = {};
  const cached = [];
  const self = {
    location: new URL("https://gozenvio.com/"),
    addEventListener: (type, fn) => (handlers[type] = fn),
    skipWaiting() {},
    clients: { claim() {} },
  };
  const caches = {
    open: async () => ({ addAll: async () => {}, put: async (req) => cached.push(new URL(req.url).pathname) }),
    match: async () => undefined,
    keys: async () => [],
  };
  const fetch = async () => ({ ok: true, type: "basic", clone() { return this; } });
  vm.runInNewContext(source, { self, caches, fetch, URL, Promise });
  return { handlers, cached };
}
async function dispatch(w, url, mode = "cors", method = "GET") {
  let responded = null;
  w.handlers.fetch({ request: { url, mode, method }, respondWith: (p) => (responded = p) });
  if (responded) await responded;
  await new Promise((r) => setTimeout(r, 0));
  return responded !== null;
}

test("private data and pages are never cached by the service worker", async () => {
  const w = worker();
  for (const path of ["/api/workspace", "/api/clients", "/api/envelopes/1/pdf", "/api/payments", "/portal/abc", "/sign/envelope"]) {
    const handled = await dispatch(w, "https://gozenvio.com" + path);
    assert.equal(handled, false, `${path} must pass through untouched`);
  }
  await dispatch(w, "https://gozenvio.com/app/clients", "navigate");
  assert.deepEqual(w.cached, []);
});

test("only hashed build assets and brand images are cached", async () => {
  const w = worker();
  await dispatch(w, "https://gozenvio.com/_next/static/chunks/main-abc.js");
  await dispatch(w, "https://gozenvio.com/brand/icon-192.png");
  await dispatch(w, "https://evil.example/_next/static/x.js");
  assert.deepEqual(w.cached, ["/_next/static/chunks/main-abc.js", "/brand/icon-192.png"]);
});

test("non-GET requests are ignored", async () => {
  const w = worker();
  assert.equal(await dispatch(w, "https://gozenvio.com/_next/static/a.js", "cors", "POST"), false);
});
