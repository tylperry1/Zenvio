// Disposable local database only. No external recipients, email, or live documents.
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
const origin = process.env.TEST_APP_URL || "http://localhost:3000";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw Error("Local test server required");
async function request(path, data, cookie) {
  const r = await fetch(origin + path, {
    method: data ? "POST" : "GET",
    headers: {
      Origin: origin,
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  return {
    r,
    status: r.status,
    data: await r
      .clone()
      .json()
      .catch(() => null),
    cookie: r.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}
const password = "A-test-password-with-12-characters!";
const a = await request("/api/auth", {
  action: "sign-up",
  name: "Envelope Owner",
  email: "envelope-owner@example.com",
  password,
});
assert.equal(a.status, 200, JSON.stringify(a.data));
const b = await request("/api/auth", {
  action: "sign-up",
  name: "Other Owner",
  email: "envelope-other@example.com",
  password,
});
assert.equal(b.status, 200);
assert.equal((await request("/api/envelopes")).status, 401);
const pdf = await PDFDocument.create();
pdf.addPage().drawText("Disposable local test agreement. No real obligations.");
const bytes = await pdf.save();
async function create() {
  const form = new FormData();
  form.set("title", "Disposable envelope");
  form.set("pdf", new Blob([bytes], { type: "application/pdf" }), "test.pdf");
  form.set(
    "recipients",
    JSON.stringify([
      { name: "First Recipient", email: "first@example.com" },
      { name: "Second Recipient", email: "second@example.com" },
    ]),
  );
  const r = await fetch(origin + "/api/envelopes", {
    method: "POST",
    headers: { Cookie: a.cookie, Origin: origin },
    body: form,
  });
  const d = await r.json();
  assert.equal(r.status, 201, JSON.stringify(d));
  return d.id;
}
const id = await create();
assert.equal(
  (await request("/api/envelopes?id=" + id, null, b.cookie)).status,
  404,
);
let d = (await request("/api/envelopes?id=" + id, null, a.cookie)).data;
const fields = d.recipients.map((r, i) => ({
  id: "signature-" + i,
  recipient: r.id,
  page: 0,
  x: 0.1,
  y: 0.3 + i * 0.2,
  width: 0.3,
  height: 0.05,
  type: "signature",
  label: "Signature",
  required: true,
}));
fields.push({
  id: "company",
  recipient: d.recipients[0].id,
  page: 0,
  x: 0.5,
  y: 0.3,
  width: 0.3,
  height: 0.05,
  type: "text",
  label: "Company",
  required: true,
});
assert.equal(
  (
    await request(
      "/api/envelopes",
      { action: "send", id, fields: fields.slice(0, 1) },
      a.cookie,
    )
  ).status,
  400,
);
assert.equal(
  (await request("/api/envelopes", { action: "save", id, fields }, b.cookie))
    .status,
  404,
);
assert.equal(
  (await request("/api/envelopes", { action: "save", id, fields }, a.cookie))
    .status,
  200,
);
const sent = await request(
  "/api/envelopes",
  { action: "send", id, fields },
  a.cookie,
);
assert.equal(sent.status, 200, JSON.stringify(sent.data));
assert.equal(sent.data.links.length, 2);
assert.equal(
  (await request("/api/envelopes", { action: "save", id, fields }, a.cookie))
    .status,
  409,
);
const tokens = sent.data.links.map((l) => l.path.split("token=")[1]);
assert.notEqual(tokens[0], tokens[1]);
assert.equal(
  (
    await request("/api/envelope-sign", {
      action: "read",
      token: "0".repeat(64),
    })
  ).status,
  404,
);
for (let i = 0; i < tokens.length; i++) {
  const token = tokens[i],
    read = await request("/api/envelope-sign", { action: "read", token });
  assert.equal(read.status, 200, JSON.stringify(read.data));
  assert(
    read.data.envelope.fields.every(
      (f) => f.recipient === read.data.recipient.id,
    ),
  );
  assert(!JSON.stringify(read.data).includes("token_hash"));
  const sign = {
    action: "sign",
    token,
    name: read.data.recipient.name,
    consent: true,
    content_hash: read.data.envelope.content_hash,
    answers: { company: "Test Co" },
  };
  assert.equal(
    (await request("/api/envelope-sign", { ...sign, consent: false })).status,
    409,
  );
  assert.equal(
    (await request("/api/envelope-sign", { ...sign, content_hash: "wrong" }))
      .status,
    409,
  );
  if (i === 0) {
    assert.equal(
      (await request("/api/envelope-sign", { ...sign, answers: {} })).status,
      400,
    );
    assert.equal(
      (await request("/api/envelope-sign", { action: "download", token }))
        .status,
      409,
    );
  }
  const signed = await request("/api/envelope-sign", sign);
  assert.equal(signed.status, 200, JSON.stringify(signed.data));
  assert.equal((await request("/api/envelope-sign", sign)).status, 409);
}
d = (await request("/api/envelopes?id=" + id, null, a.cookie)).data;
assert.equal(d.envelope.status, "completed");
assert(d.recipients.every((r) => r.status === "signed"));
assert.equal(d.events.filter((e) => e.action === "signed").length, 2);
const dl = await request("/api/envelope-sign", {
  action: "download",
  token: tokens[0],
});
assert.equal(dl.status, 200);
assert.equal(
  (await PDFDocument.load(await dl.r.arrayBuffer())).getPageCount(),
  2,
);
assert.equal(
  (await request("/api/envelopes", { action: "void", id }, a.cookie)).status,
  409,
);
const voidId = await create();
assert.equal(
  (await request("/api/envelopes", { action: "void", id: voidId }, a.cookie))
    .status,
  200,
);
const declinedId = await create();
const detail2 = (
  await request("/api/envelopes?id=" + declinedId, null, a.cookie)
).data;
const fields2 = detail2.recipients.map((r, i) => ({
  id: "decline-" + i,
  recipient: r.id,
  page: 0,
  x: 0.1,
  y: 0.3 + i * 0.2,
  width: 0.3,
  height: 0.05,
  type: "signature",
  label: "Sign",
  required: true,
}));
const dispatch = await request(
  "/api/envelopes",
  { action: "send", id: declinedId, fields: fields2 },
  a.cookie,
);
const declineTokens = dispatch.data.links.map((l) => l.path.split("token=")[1]);
assert.equal(
  (
    await request("/api/envelope-sign", {
      action: "decline",
      token: declineTokens[0],
    })
  ).status,
  200,
);
assert.equal(
  (
    await request("/api/envelope-sign", {
      action: "read",
      token: declineTokens[1],
    })
  ).status,
  404,
);
assert.equal(
  (await request("/api/envelopes?id=" + declinedId, null, a.cookie)).data
    .envelope.status,
  "declined",
);
console.log(
  "PASS envelopes: migration, actual ownership, upload, assignments, draft/send lock, private per-recipient links, required fields/consent/hash, duplicate rejection, all-signers completion, PDF receipt, void protections.",
);
