import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { Pool } from "pg";
import { chromium } from "playwright";

const origin = process.env.TEST_APP_URL;
const database = process.env.TEST_DATABASE_URL;
const loopback = ["localhost", "127.0.0.1"];
if (!origin || !database || ![origin, database].every((url) => loopback.includes(new URL(url).hostname))) {
  throw new Error("Run only against the disposable localhost fixture.");
}
const pool = new Pool({ connectionString: database });
const nonce = randomBytes(6).toString("hex");
const slug = `smart-${nonce}`;
const password = "Fixture-password-smart-card-839!";
const ownerEmail = `smart-owner-${nonce}@example.com`;
const leadEmail = `smart-lead-${nonce}@example.com`;
async function request(path, input, cookie, requestOrigin = origin) {
  return fetch(origin + path, {
    method: input ? "POST" : "GET",
    redirect: "manual",
    headers: {
      Origin: requestOrigin,
      ...(input && { "Content-Type": "application/json" }),
      ...(cookie && { Cookie: cookie }),
    },
    body: input && JSON.stringify(input),
  });
}
async function account(email) {
  const result = await request("/api/auth", { action: "sign-up", name: "Card Fixture", email, password });
  assert.equal(result.status, 200, await result.text());
  return result.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}
const profile = { action: "save-profile", slug, display_name: "Card Fixture", phone: "+1 513 555 0100", show_phone: false, capture_leads: true };

try {
  const owner = await account(ownerEmail);
  const other = await account(`smart-other-${nonce}@example.com`);
  const created = await request("/api/smart-profiles", profile, owner);
  assert.equal(created.status, 200);
  const { id } = await created.json();
  assert.equal((await request(`/p/${slug}/vcard`)).status, 404);
  assert.equal((await request("/api/smart-profiles", { ...profile, id, published: true }, other)).status, 404);
  assert.equal((await request("/api/smart-profiles", { ...profile, id, slug: "changed-slug", published: true }, owner)).status, 200);
  const vcard = await request(`/p/${slug}/vcard`);
  assert.equal(vcard.status, 200);
  assert.doesNotMatch(await vcard.text(), /TEL/);
  const svg = await request(`/p/${slug}/qr`);
  assert.equal(svg.status, 200);
  assert.match(await svg.text(), /<svg/);
  const png = await request(`/p/${slug}/qr?format=png`);
  assert.equal(png.status, 200);
  assert.equal(Buffer.from(await png.arrayBuffer()).subarray(0, 8).toString("hex"), "89504e470d0a1a0a");

  const lead = { name: "Visitor", email: leadEmail, consent: true };
  assert.equal((await request(`/p/${slug}/lead`, lead, undefined, "https://other.example")).status, 403);
  assert.equal((await request(`/p/${slug}/lead`, { ...lead, consent: false })).status, 400);
  for (let attempt = 0; attempt < 2; attempt++) assert.equal((await request(`/p/${slug}/lead`, lead)).status, 200);
  const { rows } = await pool.query(
    `SELECT c.name FROM private.smart_profile_leads l JOIN public.contacts c ON c.id=l.contact_id
      JOIN public."user" u ON u.id=c.user_id WHERE u.email=$1 AND c.email=$2`, [ownerEmail, leadEmail],
  );
  assert.deepEqual(rows, [{ name: "Visitor" }]);
  const analytics = await (await request("/api/smart-profiles?days=7", undefined, owner)).json();
  assert.ok(analytics.engagement.some((event) => event.profile_id === id && event.action === "lead" && event.total === 1));
  const registration = await request("/api/smart-profiles", { action: "create-card", profileId: id }, owner);
  assert.equal(registration.status, 200);
  const { token } = await registration.json();
  assert.equal((await request(`/c/${token}`)).headers.get("location"), "/c/inactive");
  const cards = await (await request("/api/smart-profiles", undefined, owner)).json();
  const card = cards.cards.find((item) => item.token === token);
  const activation = { action: "update-card", id: card.id, profileId: id, status: "active" };
  assert.equal((await request("/api/smart-profiles", activation, owner)).status, 409);
  assert.equal((await request("/api/smart-profiles", { ...activation, confirmEncoding: true }, owner)).status, 200);
  assert.equal((await request(`/c/${token}`)).headers.get("location"), `/p/${slug}?via=card`);

  await mkdir("test-results", { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const [label, width, height] of [["desktop", 1366, 900], ["mobile", 390, 844]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      assert.equal((await page.goto(`${origin}/p/${slug}`)).status(), 200);
      assert.equal(await page.getByRole("heading", { name: "Card Fixture", exact: true }).count(), 1);
      assert.equal(await page.getByRole("link", { name: "Save contact" }).count(), 1);
      assert.equal(await page.getByRole("button", { name: "Share my details" }).count(), 1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await page.screenshot({ path: `test-results/smart-card-${label}.png`, fullPage: true });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  assert.equal((await request("/api/smart-profiles", { action: "archive-profile", id }, owner)).status, 200);
  assert.equal((await request(`/c/${token}`)).headers.get("location"), "/c/inactive");
  assert.equal((await request(`/p/${slug}/lead`, lead)).status, 404);
  assert.equal((await request(`/p/${slug}/qr`)).status, 404);
  assert.equal((await request("/api/smart-profiles", profile, other)).status, 409);
  console.log("Smart Card publication, tenant isolation, QR, vCard, NFC, CRM, analytics and responsive browser checks passed.");
} finally {
  await pool.end();
}
