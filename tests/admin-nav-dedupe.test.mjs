import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const operations = fs.readFileSync("src/components/operations.tsx", "utf8");
const center = fs.readFileSync("src/components/admin-center.tsx", "utf8");
const marketplace = fs.readFileSync("src/components/admin-marketplace.tsx", "utf8");

test("operations pages do not render a second destination tab bar", () => {
  assert.doesNotMatch(operations, /operations-tabs/);
  assert.doesNotMatch(operations, /Platform sections/);
  assert.doesNotMatch(operations, /setView\(/);
  assert.match(operations, /sidebar is the only destination switcher/);
});

test("command center uses URL navigation instead of client-only sidebar overrides", () => {
  assert.doesNotMatch(center, /onNavigate=\{/);
  assert.match(center, /router\.push\(href\)/);
  assert.match(center, /View is owned by the URL/);
});

test("marketplace contextual tabs distinguish product suppliers from sidebar Suppliers", () => {
  assert.match(marketplace, /Product suppliers/);
  assert.match(marketplace, /Marketplace views/);
});
