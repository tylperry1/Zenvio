import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";

function fixture({ invalid = false, throwProcessing = false, duplicate = false } = {}) {
  let processed = 0;
  const filename = path.resolve("src/app/api/billing/webhook/route.ts");
  const m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  m.require = (id) => {
    if (id === "next/server") return {};
    if (id === "@/lib/platform-settings")
      return { integrationValue: async () => "whsec_test_fixture" };
    if (id === "@/lib/billing")
      return {
        stripeClient: async () => ({
          webhooks: {
            constructEvent() {
              if (invalid) throw Error("bad signature");
              return { id: "evt_test_fixture", type: "customer.subscription.updated", data: { object: { id: "sub_fixture" } } };
            },
          },
        }),
      };
    if (id === "@/lib/stripe-webhook")
      return {
        processStripeEvent: async () => {
          processed += 1;
          if (throwProcessing) throw Error("card data must never surface: 4242424242424242");
          return { duplicate };
        },
      };
    if (id === "@/lib/stripe-webhook-runtime")
      return { stripeWebhookDeps: async () => ({ connect: async () => ({}) }) };
    return {};
  };
  m._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  );
  return { POST: m.exports.POST, get processed() { return processed; } };
}

const request = () =>
  new Request("https://fixture.invalid/api/billing/webhook", { method: "POST", body: "fixture" });

test("Stripe signature rejection never processes an event", async () => {
  const f = fixture({ invalid: true });
  assert.equal((await f.POST(request())).status, 400);
  assert.equal(f.processed, 0);
});

test("a verified delivery is processed once through the durable event log", async () => {
  const f = fixture();
  const response = await f.POST(request());
  assert.equal(response.status, 200);
  assert.equal(f.processed, 1);
});

test("duplicate deliveries are acknowledged without a second application", async () => {
  const f = fixture({ duplicate: true });
  const response = await f.POST(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).duplicate, true);
});

test("processing failures return 500 without leaking provider or payment details", async () => {
  const f = fixture({ throwProcessing: true });
  const response = await f.POST(request());
  assert.equal(response.status, 500);
  const body = await response.text();
  assert.doesNotMatch(body, /4242/);
  assert.doesNotMatch(body, /card/i);
});
