// Run only with a disposable localhost database and test server. No provider mail or payments.
import assert from "node:assert/strict";
import { Pool } from "pg";
import { PDFDocument } from "pdf-lib";
const origin = process.env.TEST_APP_URL || "http://127.0.0.1:3100",
  url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
  !["localhost", "127.0.0.1"].includes(new URL(origin).hostname)
)
  throw Error("Disposable localhost database and server required");
const db = new Pool({ connectionString: url });
const password = "An-isolated-password-123456789!";
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
    status: r.status,
    data: await r
      .clone()
      .json()
      .catch(() => null),
    cookie: r.headers
      .getSetCookie()
      .map((s) => s.split(";")[0])
      .join("; "),
    response: r,
  };
}
const signup = (email, name) =>
  request("/api/auth", { action: "sign-up", email, name, password });
const login = (email) =>
  request("/api/auth", { action: "sign-in", email, password });
try {
  let setup = await request("/api/owner/setup", {
    token: process.env.TEST_OWNER_TOKEN,
    name: "Fixture Owner",
    password,
  });
  assert.equal(setup.status, 200, JSON.stringify(setup.data));
  const owner = await login("owner@example.com");
  assert.equal(owner.status, 200);
  const alice = await signup("alice@example.com", "Alice Fixture"),
    bob = await signup("bob@example.com", "Bob Fixture"),
    foreign = await signup("foreign@example.com", "Foreign Fixture");
  assert.equal(alice.status, 200, JSON.stringify(alice.data));
  assert.equal(bob.status, 200);
  const wa = (await request("/api/workspace", null, alice.cookie)).data,
    wb = (await request("/api/workspace", null, bob.cookie)).data;
  const aid = wa.profile.id,
    bid = wb.profile.id,
    event = wa.events[0];
  assert.equal((await request("/api/lifecycle")).status, 401);
  assert.equal(
    (
      await request(
        "/api/lifecycle",
        {
          action: "policy",
          id: event.id,
          reminders: [1440, 60],
          cancellation_notice: 30,
          reschedule_notice: 60,
        },
        bob.cookie,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        "/api/lifecycle",
        {
          action: "policy",
          id: event.id,
          reminders: [1440, 60],
          cancellation_notice: 30,
          reschedule_notice: 60,
        },
        alice.cookie,
      )
    ).status,
    200,
  );
  const question = {
    id: "goals",
    label: "Your goals",
    type: "short_text",
    required: true,
    options: [],
  };
  assert.equal(
    (
      await request(
        "/api/intake",
        { id: event.id, questions: [question] },
        alice.cookie,
      )
    ).status,
    200,
  );
  let slots = [],
    date;
  for (let i = 3; i < 10; i++) {
    date = new Date(Date.now() + i * 86400000).toISOString().slice(0, 10);
    const r = await request(
      "/api/book?" +
        new URLSearchParams({ host: wa.profile.slug, event: event.slug, date }),
    );
    assert.equal(r.status, 200, JSON.stringify(r.data));
    if (r.data.slots.length) {
      slots = r.data.slots;
      break;
    }
  }
  assert(slots.length > 2);
  const details = {
    host: wa.profile.slug,
    event: event.slug,
    starts_at: slots[0],
    name: "Disposable Guest",
    email: "guest@example.com",
  };
  assert.equal((await request("/api/book", details)).status, 400);
  const booked = await request("/api/book", {
    ...details,
    answers: { goals: "Test scheduling" },
  });
  assert.equal(booked.status, 201, JSON.stringify(booked.data));
  const bookingId = booked.data.id;
  assert.equal(
    (
      await db.query(
        "SELECT intake_snapshot FROM public.bookings WHERE id=$1",
        [bookingId],
      )
    ).rows[0].intake_snapshot[0].answer,
    "Test scheduling",
  );
  const lifecycle = (await request("/api/lifecycle", null, alice.cookie)).data;
  const jobs = (
    await db.query("SELECT * FROM private.delivery_jobs WHERE booking_id=$1", [
      bookingId,
    ])
  ).rows;
  assert(jobs.length >= 2);
  assert(!JSON.stringify(lifecycle).includes("payload_ciphertext"));
  assert(!JSON.stringify(jobs).includes(booked.data.cancel_token));
  const foreignMove = await request(
    "/api/reschedule",
    { action: "move", id: bookingId, starts_at: slots[2] },
    bob.cookie,
  );
  assert.equal(foreignMove.status, 404);
  const moved = await request("/api/reschedule", {
    action: "move",
    token: booked.data.cancel_token,
    starts_at: slots[2],
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  assert.equal(moved.data.id, bookingId);
  assert.equal(
    (
      await db.query("SELECT revision FROM public.bookings WHERE id=$1", [
        bookingId,
      ])
    ).rows[0].revision,
    1,
  );
  assert(
    (
      await db.query(
        "SELECT 1 FROM private.delivery_jobs WHERE booking_id=$1 AND status='cancelled'",
        [bookingId],
      )
    ).rowCount > 0,
  );
  const usage = (await request("/api/usage", null, alice.cookie)).data;
  assert.equal(usage.plan, "free");
  assert.equal(usage.limits.envelopes, 5);
  assert.equal(
    (await request("/api/admin/entitlements", null, alice.cookie)).status,
    403,
  );
  const expires = new Date(Date.now() + 3 * 86400000).toISOString();
  assert.equal(
    (
      await request(
        "/api/admin/entitlements",
        {
          action: "override",
          user: aid,
          plan: "teams",
          expires,
          reason: "Isolated workflow and team fixture",
        },
        owner.cookie,
      )
    ).status,
    200,
  );
  const pdf = await PDFDocument.create();
  pdf
    .addPage()
    .drawText("Disposable fixture only. No real agreement.", {
      x: 48,
      y: 720,
      size: 16,
    });
  const bytes = await pdf.save(),
    form = new FormData();
  form.set("title", "Disposable PDF template");
  form.set(
    "pdf",
    new Blob([bytes], { type: "application/pdf" }),
    "fixture.pdf",
  );
  form.set(
    "recipients",
    JSON.stringify([{ name: "Fixture Signer", email: "signer@example.com" }]),
  );
  const upload = await fetch(origin + "/api/envelopes", {
    method: "POST",
    headers: { Origin: origin, Cookie: alice.cookie },
    body: form,
  });
  const envelope = await upload.json();
  assert.equal(upload.status, 201, JSON.stringify(envelope));
  const envelopeId = envelope.id;
  let doc = (
    await request("/api/envelopes?id=" + envelopeId, null, alice.cookie)
  ).data;
  const rid = doc.recipients[0].id,
    fields = [
      {
        id: "sign",
        recipient: rid,
        page: 0,
        x: 0.1,
        y: 0.3,
        width: 0.3,
        height: 0.05,
        type: "signature",
        label: "Signature",
        required: true,
      },
    ];
  assert.equal(
    (
      await request(
        "/api/envelopes",
        { action: "save", id: envelopeId, fields },
        alice.cookie,
      )
    ).status,
    200,
  );
  const template = await request(
    "/api/pdf-templates",
    {
      action: "save_from_envelope",
      envelope_id: envelopeId,
      name: "Fixture template",
      roles: ["Client"],
    },
    alice.cookie,
  );
  assert.equal(template.status, 200, JSON.stringify(template.data));
  const tid = template.data.id;
  const forbidden = await request(
    "/api/pdf-templates",
    {
      action: "instantiate",
      id: tid,
      assignments: [{ name: "Other", email: "other@example.com" }],
    },
    bob.cookie,
  );
  assert.equal(forbidden.status, 404);
  const made = await request(
    "/api/pdf-templates",
    {
      action: "instantiate",
      id: tid,
      assignments: [{ name: "Client Fixture", email: "fixture@example.com" }],
    },
    alice.cookie,
  );
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const firstVersion = (
    await db.query(
      "SELECT fields FROM private.signature_envelopes WHERE id=$1",
      [made.data.id],
    )
  ).rows[0].fields;
  assert.notEqual(firstVersion[0].recipient, rid);
  assert.equal(
    (
      await request(
        "/api/pdf-templates",
        {
          action: "save_from_envelope",
          id: tid,
          envelope_id: envelopeId,
          name: "Fixture v2",
          roles: ["Client"],
        },
        alice.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM private.pdf_template_versions WHERE template_id=$1",
        [tid],
      )
    ).rows[0].n,
    2,
  );
  const dispatched = await request(
    "/api/envelopes",
    {
      action: "send",
      id: envelopeId,
      fields,
      email_delivery: true,
      reminder_days: [2, 5],
    },
    alice.cookie,
  );
  assert.equal(dispatched.status, 200, JSON.stringify(dispatched.data));
  const secret = dispatched.data.links[0].path.split("token=")[1];
  doc = (await request("/api/envelopes?id=" + envelopeId, null, alice.cookie))
    .data;
  assert(!JSON.stringify(doc).includes("link_ciphertext"));
  const stored = (
    await db.query("SELECT * FROM private.signature_recipients WHERE id=$1", [
      rid,
    ])
  ).rows[0];
  assert(stored.link_ciphertext && !stored.link_ciphertext.includes(secret));
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM private.delivery_jobs WHERE envelope_id=$1",
        [envelopeId],
      )
    ).rows[0].n,
    3,
  );
  const read = (
    await request("/api/envelope-sign", { action: "read", token: secret })
  ).data;
  const signed = await request("/api/envelope-sign", {
    action: "sign",
    token: secret,
    name: "Fixture Signer",
    consent: true,
    content_hash: read.envelope.content_hash,
    answers: {},
  });
  assert.equal(signed.status, 200, JSON.stringify(signed.data));
  assert(
    (
      await db.query(
        "SELECT count(*)::int n FROM private.delivery_jobs WHERE envelope_id=$1 AND kind='document_complete'",
        [envelopeId],
      )
    ).rows[0].n >= 2,
  );
  const clients = (await request("/api/clients", null, alice.cookie)).data
    .contacts;
  assert(clients.length);
  const contact = clients.find((c) => c.email === "guest@example.com");
  assert(contact);
  assert.equal(
    (await request("/api/clients?id=" + contact.id, null, bob.cookie)).status,
    404,
  );
  assert.equal(
    (
      await request(
        "/api/clients",
        { action: "link_envelope", id: contact.id, envelope_id: envelopeId },
        alice.cookie,
      )
    ).status,
    200,
  );
  const record = (
    await request("/api/clients?id=" + contact.id, null, alice.cookie)
  ).data;
  assert(record.bookings.some((b) => b.id === bookingId));
  assert(record.envelopes.some((e) => e.id === envelopeId));
  const rule = await request(
    "/api/workflows",
    {
      action: "create",
      name: "Test follow-up",
      trigger: "after_appointment",
      workflow_action: "email_guest",
      minutes: 30,
      subject: "Fixture follow up",
      message: "Disposable fixture",
    },
    alice.cookie,
  );
  assert.equal(rule.status, 200, JSON.stringify(rule.data));
  const flows = (await request("/api/workflows", null, alice.cookie)).data;
  assert.equal(
    (
      await request(
        "/api/workflows",
        { action: "toggle", id: flows.rules[0].id, enabled: true },
        alice.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        "/api/workflows",
        { action: "toggle", id: flows.rules[0].id, enabled: true },
        bob.cookie,
      )
    ).status,
    404,
  );
  const team = await request(
    "/api/teams",
    { action: "create", name: "Fixture Team", slug: "fixture-team" },
    alice.cookie,
  );
  assert.equal(team.status, 200, JSON.stringify(team.data));
  const organization = team.data.id;
  assert.equal(
    (await request("/api/teams?id=" + organization, null, foreign.cookie))
      .status,
    403,
  );
  const invite = await request(
    "/api/teams",
    { action: "invite", organization, email: "bob@example.com", role: "staff" },
    alice.cookie,
  );
  assert.equal(invite.status, 200);
  const inviteToken = invite.data.invitationPath.split("token=")[1];
  assert.equal(
    (
      await request(
        "/api/teams",
        { action: "accept", token: inviteToken },
        foreign.cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/teams",
        { action: "accept", token: inviteToken },
        bob.cookie,
      )
    ).status,
    200,
  );
  const staffUsage = (await request("/api/usage", null, bob.cookie)).data;
  assert.equal(staffUsage.plan, "teams");
  assert.equal(staffUsage.limits.envelopes, 100);
  assert.equal(staffUsage.shared[0].seats, 3);
  assert.equal(
    (
      await request(
        "/api/teams",
        {
          action: "create",
          name: "Unauthorized inherited billing",
          slug: "no-extra-seats",
        },
        bob.cookie,
      )
    ).status,
    409,
  );
  const shared = await request(
    "/api/teams",
    {
      action: "event",
      organization,
      title: "Fixture team appointment",
      slug: "shared",
      duration: 30,
      buffer: 15,
      staff: [aid, bid],
    },
    alice.cookie,
  );
  assert.equal(shared.status, 200, JSON.stringify(shared.data));
  assert.equal(
    (
      await request(
        "/api/teams",
        {
          action: "invite",
          organization,
          email: "no@example.com",
          role: "staff",
        },
        bob.cookie,
      )
    ).status,
    403,
  );
  const teamSlots = await request(
    "/api/team-book?" +
      new URLSearchParams({
        organization: "fixture-team",
        event: "shared",
        date,
      }),
  );
  assert.equal(teamSlots.status, 200, JSON.stringify(teamSlots.data));
  assert(teamSlots.data.slots.length);
  const teamBook = await request("/api/team-book", {
    organization: "fixture-team",
    event: "shared",
    starts_at:
      teamSlots.data.slots.find((s) => !slots.slice(0, 5).includes(s)) ||
      teamSlots.data.slots.at(-1),
    name: "Team Guest",
    email: "teamguest@example.com",
  });
  assert.equal(teamBook.status, 201, JSON.stringify(teamBook.data));
  const assigned = (
    await db.query("SELECT user_id FROM public.bookings WHERE id=$1", [
      teamBook.data.id,
    ])
  ).rows[0].user_id;
  const target = assigned === aid ? bid : aid;
  const reassigned = await request(
    "/api/teams",
    {
      action: "reassign",
      organization,
      booking_id: teamBook.data.id,
      user_id: target,
    },
    alice.cookie,
  );
  assert.equal(reassigned.status, 200, JSON.stringify(reassigned.data));
  assert.equal(
    (
      await db.query("SELECT user_id FROM public.bookings WHERE id=$1", [
        teamBook.data.id,
      ])
    ).rows[0].user_id,
    target,
  );
  if (target === bid)
    assert.equal(
      (
        await request(
          "/api/teams",
          { action: "remove", organization, user_id: bid },
          alice.cookie,
        )
      ).status,
      409,
    );
  assert.equal(
    (
      await request(
        "/api/teams",
        { action: "cancel", organization, booking_id: teamBook.data.id },
        alice.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        "/api/teams",
        { action: "remove", organization, user_id: bid },
        alice.cookie,
      )
    ).status,
    200,
  );
  const automation = await request(
    "/api/workflows",
    {
      action: "create",
      name: "Fixture booking confirmation",
      trigger: "after_booking",
      workflow_action: "email_guest",
      minutes: 0,
      subject: "Fixture workflow delivery",
      message: "Isolated test; no provider configured",
    },
    alice.cookie,
  );
  assert.equal(automation.status, 200);
  const automationRule = (
    await request("/api/workflows", null, alice.cookie)
  ).data.rules.find((r) => r.name === "Fixture booking confirmation");
  assert.equal(
    (
      await request(
        "/api/workflows",
        { action: "toggle", id: automationRule.id, enabled: true },
        alice.cookie,
      )
    ).status,
    200,
  );
  const later = (
    await request(
      "/api/book?" +
        new URLSearchParams({ host: wa.profile.slug, event: event.slug, date }),
    )
  ).data.slots.at(-1);
  const workflowBooking = await request("/api/book", {
    ...details,
    starts_at: later,
    answers: { goals: "Workflow fixture" },
  });
  assert.equal(
    workflowBooking.status,
    201,
    JSON.stringify(workflowBooking.data),
  );
  await request("/api/lifecycle", { action: "process" }, alice.cookie);
  for (let n = 0; n < 20; n++) {
    if (
      (
        await db.query(
          "SELECT 1 FROM private.workflow_runs WHERE rule_id=$1 AND booking_id=$2",
          [automationRule.id, workflowBooking.data.id],
        )
      ).rowCount
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await request("/api/lifecycle", { action: "process" }, alice.cookie);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM private.workflow_runs WHERE rule_id=$1 AND booking_id=$2",
        [automationRule.id, workflowBooking.data.id],
      )
    ).rows[0].n,
    1,
  );
  if (process.env.TEST_REAL_POSTGRES === "true") {
    const solo = wb.events[0],
      available = (
        await request(
          "/api/book?" +
            new URLSearchParams({
              host: wb.profile.slug,
              event: solo.slug,
              date,
            }),
        )
      ).data.slots.at(-1);
    const payload = {
      host: wb.profile.slug,
      event: solo.slug,
      starts_at: available,
      name: "Race fixture",
      email: "race@example.com",
    };
    const race = await Promise.all([
      request("/api/book", payload),
      request("/api/book", { ...payload, email: "race2@example.com" }),
    ]);
    assert.deepEqual(race.map((r) => r.status).sort(), [201, 409]);
  }
  assert.equal(
    (
      await request(
        "/api/appointment-payments",
        { action: "onboard" },
        alice.cookie,
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await request(
        "/api/subscription-enroll",
        { plan: "pro", period: "monthly", confirm: true },
        alice.cookie,
      )
    ).status,
    503,
  );
  assert.equal(
    (await request("/api/appointment-payments/webhook", { fake: true })).status,
    503,
  );
  assert.equal(
    (
      await request(
        "/api/admin/marketplace/personalization",
        {
          action: "options",
          id: "00000000-0000-4000-8000-000000000000",
          options: [],
        },
        bob.cookie,
      )
    ).status,
    403,
  );
  const demo = (
    await db.query(
      "SELECT id FROM private.marketplace_products WHERE is_demo LIMIT 1",
    )
  ).rows[0];
  assert(demo);
  assert.equal(
    (
      await request(
        "/api/marketplace",
        { lines: [{ productId: demo.id, quantity: 1 }] },
        alice.cookie,
      )
    ).status,
    503,
  );
  const completedRule = await request(
    "/api/workflows",
    {
      action: "create",
      name: "Legacy completion notice",
      trigger: "document_completed",
      workflow_action: "email_host",
      minutes: 0,
      subject: "Legacy fixture completed",
      message: "Isolated fixture",
    },
    alice.cookie,
  );
  assert.equal(completedRule.status, 200);
  const completionId = (
    await request("/api/workflows", null, alice.cookie)
  ).data.rules.find((r) => r.name === "Legacy completion notice").id;
  await request(
    "/api/workflows",
    { action: "toggle", id: completionId, enabled: true },
    alice.cookie,
  );
  const legacy = await request(
    "/api/documents",
    {
      action: "create",
      title: "Legacy fixture",
      content: "Disposable legacy text agreement for isolated testing only.",
      name: "Fixture Legacy Signer",
      email: "legacy@example.com",
      email_delivery: true,
      reminder_days: [2, 6],
    },
    alice.cookie,
  );
  assert.equal(legacy.status, 201, JSON.stringify(legacy.data));
  await db.query(
    "UPDATE private.delivery_jobs SET created_at=now()-interval '6 minutes' WHERE document_id=$1",
    [legacy.data.id],
  );
  assert.equal(
    (
      await request(
        "/api/documents",
        { action: "resend", id: legacy.data.id },
        alice.cookie,
      )
    ).status,
    200,
  );
  assert(
    !JSON.stringify(
      (await request("/api/documents?id=" + legacy.data.id, null, alice.cookie))
        .data,
    ).includes("link_ciphertext"),
  );
  const legacyToken = legacy.data.signingPath.split("token=")[1],
    legacyRead = (
      await request("/api/sign", { action: "read", token: legacyToken })
    ).data;
  const legacySigned = await request("/api/sign", {
    action: "sign",
    token: legacyToken,
    name: "Fixture Legacy Signer",
    consent: true,
    content_hash: legacyRead.document.content_hash,
  });
  assert.equal(legacySigned.status, 200, JSON.stringify(legacySigned.data));
  await request("/api/lifecycle", { action: "process" }, alice.cookie);
  for (let n = 0; n < 30; n++) {
    if (
      (
        await db.query(
          "SELECT 1 FROM private.workflow_runs WHERE rule_id=$1 AND document_id=$2",
          [completionId, legacy.data.id],
        )
      ).rowCount
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM private.workflow_runs WHERE rule_id=$1 AND document_id=$2",
        [completionId, legacy.data.id],
      )
    ).rows[0].n,
    1,
  );
  console.log(
    "PASS upgrade integration: migrations, ownership, required intake snapshots, immutable reschedule IDs and reminder cancellation, encrypted per-recipient delivery, template versions, client links, workflow permissions, team invitations and shared reservations, provider/payment gates, and admin isolation.",
  );
} finally {
  await db.end();
}
