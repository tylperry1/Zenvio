import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import sharp from "sharp";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const origin = process.env.TEST_APP_URL;
const database = process.env.TEST_DATABASE_URL;
if (!origin || !database || ![origin, database].every((value) => ["localhost", "127.0.0.1"].includes(new URL(value).hostname))) throw Error("Disposable localhost fixture required");
const db = new Pool({ connectionString: database });
async function request(path, data, cookie, headers = {}) {
  return fetch(origin + path, {
    method: data ? "POST" : "GET", headers: { Origin: origin, ...(data && { "Content-Type": "application/json" }), ...(cookie && { Cookie: cookie }), ...headers },
    ...(data && { body: JSON.stringify(data) }),
  });
}
const nonce = randomUUID();
const password = "Support-fixture-password-12345!";
async function account(email) {
  const result = await request("/api/auth", { action: "sign-up", name: "Support Fixture", email, password });
  assert.equal(result.status, 200, await result.text());
  return result.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}
try {
  const ownerEmail = `support-owner-${nonce}@example.com`;
  const staffEmail = `support-staff-${nonce}@example.com`;
  const owner = await account(ownerEmail), staff = await account(staffEmail), stranger = await account(`support-stranger-${nonce}@example.com`);
  const users = (await db.query('SELECT id,email FROM public."user" WHERE email=ANY($1)', [[ownerEmail, staffEmail]])).rows;
  const staffId = users.find((user) => user.email === staffEmail).id;
  await db.query('UPDATE public."user" SET "emailVerified"=true WHERE id=$1', [staffId]);
  await db.query("INSERT INTO private.staff_members(user_id,title,permissions,workspace_plan,enabled) VALUES($1,'Support fixture',ARRAY['support','integrations'],'individual',true)", [staffId]);
  assert.equal((await request("/api/support")).status, 401);
  assert.equal((await request("/api/admin/support", undefined, owner)).status, 403);
  assert.equal((await request("/api/admin/email-preview", undefined, owner)).status, 403);
  const preview = await request("/api/admin/email-preview", undefined, staff);
  assert.equal(preview.status, 200);
  assert.match((await preview.json()).html, /Zenvio/);
  const data = { action: "create", subject: "Booking help", content: "I need help with availability.", reference: randomUUID() };
  const created = await request("/api/support", data, owner);
  assert.equal(created.status, 200, await created.clone().text());
  const { id } = await created.json();
  assert.equal((await (await request("/api/support", data, owner)).json()).id, id);
  assert.equal((await request("/api/support?ticket=" + id, undefined, stranger)).status, 404);
  assert.equal((await request("/api/support", { action: "message", ticket: id, content: "Bad", reference: randomUUID() }, owner, { Origin: "https://other.example" })).status, 403);
  const note = { action: "message", ticket: id, internal: true, content: "Private staff note", reference: randomUUID() };
  assert.equal((await request("/api/admin/support", note, staff)).status, 200);
  const reply = { action: "message", ticket: id, content: "Please review your event availability.", reference: randomUUID() };
  assert.equal((await request("/api/admin/support", reply, staff)).status, 200);
  assert.equal((await request("/api/admin/support", reply, staff)).status, 200);
  const image = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#365cff" } }).png().toBuffer();
  const upload = await fetch(origin + "/api/support/attachment?" + new URLSearchParams({ ticket: id, reference: randomUUID(), filename: "screenshot.png" }), {
    method: "POST", headers: { Origin: origin, Cookie: owner, "Content-Type": "image/png" }, body: image,
  });
  assert.equal(upload.status, 200, await upload.text());
  const history = await (await request("/api/support?ticket=" + id, undefined, owner)).json();
  assert.equal(history.messages.length, 3);
  const attachment = history.messages.find((message) => message.attachment);
  assert.ok(attachment);
  const download = await request("/api/support/attachment?message=" + attachment.id, undefined, owner);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "image/jpeg");
  assert.equal((await request("/api/support/attachment?message=" + attachment.id, undefined, stranger)).status, 404);
  assert.ok(history.messages.every((message) => !message.internal));
  assert.equal((await db.query("SELECT count(*)::int n FROM private.delivery_jobs WHERE dedupe_key=$1", ["support:" + reply.reference])).rows[0].n, 1);
  assert.equal((await request("/api/admin/support", { action: "update", ticket: id, assigned: "self", status: "pending" }, staff)).status, 200);
  await mkdir("test-results", { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const [label,width] of [["desktop",1440],["tablet",820],["mobile",390]]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, extraHTTPHeaders: { Cookie: owner } });
      await page.goto(origin + "/app/support?ticket=" + id);
      await page.getByText(reply.content, { exact: true }).waitFor();
      assert.equal(await page.getByText(note.content, { exact: true }).count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: `test-results/support-${label}.png`, fullPage: true });
      await page.close();
    }
    const admin = await browser.newPage({ extraHTTPHeaders: { Cookie: staff } });
    await admin.goto(origin + "/admin/support?ticket=" + id);
    await admin.getByText(note.content, { exact: true }).waitFor();
    await admin.screenshot({ path: "test-results/support-admin.png", fullPage: true });
    await admin.goto(origin + "/admin/email-preview");
    await admin.getByRole("heading", { name: "Transactional email preview" }).waitFor();
    await admin.screenshot({ path: "test-results/email-preview.png", fullPage: true });
  } finally { await browser.close(); }
  await db.query("UPDATE private.staff_members SET enabled=false WHERE user_id=$1", [staffId]);
  assert.equal((await request("/api/admin/support", undefined, staff)).status, 403);
  console.log("Support tenant isolation, internal note privacy, permission revocation, idempotency, notification queue and responsive checks passed.");
} finally { await db.end(); }
