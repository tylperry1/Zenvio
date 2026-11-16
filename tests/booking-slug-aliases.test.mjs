import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("booking slug alias migration records old hosts and resolves them", () => {
  const sql = fs.readFileSync("postgres/migrations/082_booking_slug_aliases.sql", "utf8");
  assert.match(sql, /booking_slug_aliases/);
  assert.match(sql, /resolve_booking_slug/);
  assert.match(sql, /record_booking_slug_alias/);
  assert.match(sql, /guard_booking_slug_claim/);
  assert.match(sql, /public_profile/);
});

test("book pages redirect legacy hosts to the live slug", () => {
  const host = fs.readFileSync("src/app/book/[host]/page.tsx", "utf8");
  const event = fs.readFileSync("src/app/book/[host]/[event]/page.tsx", "utf8");
  assert.match(host, /resolveBookingSlug/);
  assert.match(host, /redirect\(`\/book\/\$\{live\}`\)/);
  assert.match(event, /resolveBookingSlug/);
  assert.match(event, /redirect\(`\/book\/\$\{live\}\/\$\{event\}`\)/);
});

test("book API resolves legacy hosts before lookup", () => {
  const route = fs.readFileSync("src/app/api/book/route.ts", "utf8");
  assert.match(route, /resolveBookingSlug/);
  assert.match(route, /liveHost/);
});
