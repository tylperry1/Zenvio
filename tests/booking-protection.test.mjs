import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";

class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const counts = new Map();
let keys = {},
  verifications = [],
  verifyResult = true;
const filename = path.resolve("src/lib/booking-protection.ts"),
  m = new Module(filename);
m.filename = filename;
m.paths = Module._nodeModulePaths(path.dirname(filename));
const original = m.require.bind(m);
m.require = (id) =>
  id === "./db"
    ? {
        // Emulates the fixed-window upsert: one counter per hashed key.
        getPool: () => ({
          query: async (sql, params) => {
            if (sql.startsWith("delete")) return { rows: [] };
            const next = (counts.get(params[0]) || 0) + 1;
            counts.set(params[0], next);
            return { rows: [{ count: next }] };
          },
        }),
      }
    : id === "./platform-settings"
      ? { integrationValue: async (name) => keys[name] || "" }
      : id === "./server"
        ? { ApiError }
        : original(id);
m._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText,
  filename,
);
const { protectBooking, clientIp, captchaSiteKey } = m.exports;
const request = (ip) => ({
  headers: new Headers(ip ? { "x-forwarded-for": ip + ", 10.0.0.1" } : {}),
});
globalThis.fetch = async (url, init) => {
  verifications.push({ url, body: String(init.body) });
  return Response.json({ success: verifyResult });
};
beforeEach(() => {
  counts.clear();
  keys = {};
  verifications = [];
  verifyResult = true;
});

test("uses the first forwarded address as the client IP", () => {
  assert.equal(clientIp(request("203.0.113.5")), "203.0.113.5");
  assert.equal(clientIp(request()), "unknown");
});

test("allows ten bookings per IP per hour, then rejects with 429", async () => {
  for (let i = 0; i < 10; i++) await protectBooking(request("203.0.113.5"), "");
  await assert.rejects(protectBooking(request("203.0.113.5"), ""), (e) => e.status === 429);
  await protectBooking(request("198.51.100.1"), "");
});

test("skips CAPTCHA until both Turnstile keys are configured", async () => {
  keys = { TURNSTILE_SITE_KEY: "site" };
  assert.equal(await captchaSiteKey(), "");
  await protectBooking(request("203.0.113.5"), undefined);
  assert.equal(verifications.length, 0);
});

test("requires a valid CAPTCHA token once configured", async () => {
  keys = { TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret" };
  assert.equal(await captchaSiteKey(), "site");
  await assert.rejects(protectBooking(request("203.0.113.5"), ""), (e) => e.status === 400);
  assert.equal(verifications.length, 0);
  await protectBooking(request("203.0.113.5"), "token");
  assert.match(verifications[0].body, /secret=secret&response=token&remoteip=203\.0\.113\.5/);
  verifyResult = false;
  await assert.rejects(protectBooking(request("203.0.113.5"), "token"), (e) => e.status === 400);
});
