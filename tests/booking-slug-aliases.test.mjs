import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import ts from "typescript";

function load(file, deps = {}) {
  const filename = path.resolve(file);
  const m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = m.require.bind(m);
  m.require = (id) => (Object.hasOwn(deps, id) ? deps[id] : original(id));
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
  return m.exports;
}

test("booking slug alias migration records old hosts and resolves them", () => {
  const sql = fs.readFileSync("postgres/migrations/082_booking_slug_aliases.sql", "utf8");
  assert.match(sql, /booking_slug_aliases/);
  assert.match(sql, /resolve_booking_slug/);
  assert.match(sql, /record_booking_slug_alias/);
  assert.match(sql, /guard_booking_slug_claim/);
  assert.match(sql, /public_profile/);
});

test("signup reserves aliases and retries with another suffix", () => {
  const sql = fs.readFileSync("postgres/migrations/084_booking_slug_alias_signup.sql", "utf8");
  assert.match(sql, /BEFORE INSERT OR UPDATE OF slug/);
  assert.match(sql, /booking_slug_aliases a WHERE a\.slug = candidate/);
  assert.match(sql, /WHEN check_violation THEN/);
  assert.match(sql, /handle_new_user/);
});

test("book pages redirect legacy hosts to the live slug and keep query params", () => {
  const host = fs.readFileSync("src/app/book/[host]/page.tsx", "utf8");
  const event = fs.readFileSync("src/app/book/[host]/[event]/page.tsx", "utf8");
  assert.match(host, /resolveBookingSlug/);
  assert.match(host, /bookingQueryString/);
  assert.match(host, /redirect\(`\/book\/\$\{live\}\$\{bookingQueryString\(await searchParams\)\}`\)/);
  assert.match(event, /resolveBookingSlug/);
  assert.match(event, /bookingQueryString/);
  assert.match(
    event,
    /redirect\(`\/book\/\$\{live\}\/\$\{event\}\$\{bookingQueryString\(await searchParams\)\}`\)/,
  );
});

test("bookingQueryString preserves attribution and payment return params", () => {
  const { bookingQueryString } = load("src/lib/booking-slug.ts", {
    "./db": { getPool: () => ({ query: async () => ({ rows: [] }) }) },
  });
  assert.equal(bookingQueryString({}), "");
  assert.equal(
    bookingQueryString({ src: "nfc", utm_source: "ig", payment: "processing" }),
    "?src=nfc&utm_source=ig&payment=processing",
  );
  assert.equal(bookingQueryString({ utm_campaign: ["a", "b"] }), "?utm_campaign=a&utm_campaign=b");
});

test("book API resolves legacy hosts before lookup", () => {
  const route = fs.readFileSync("src/app/api/book/route.ts", "utf8");
  assert.match(route, /resolveBookingSlug/);
  assert.match(route, /liveHost/);
});
