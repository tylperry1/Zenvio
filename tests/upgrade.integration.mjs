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
  // Booking notifications are materialized by Next after(); the HTTP response
  // deliberately precedes that durable background work. Wait for its observable
  // result rather than racing the response against the queue insertion.
  let jobs = [];
  const reminderDeadline = Date.now() + 5000;
  do {
    jobs = (await db.query("SELECT * FROM private.delivery_jobs WHERE booking_id=$1", [bookingId])).rows;
    if (jobs.length >= 2) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < reminderDeadline);
  assert(jobs.length >= 2, "booking reminders must be durably queued within five seconds");
  assert(jobs.filter(j => ["booking_confirmation","booking_reminder"].includes(j.kind)).every(j => j.calendar_ciphertext && !j.calendar_ciphertext.includes("BEGIN:VCALENDAR")), "calendar attachments must be encrypted at rest");
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
  pdf.addPage().drawText("Disposable fixture only. No real agreement.", {
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
  const edit = {action:"edit",id:contact.id,name:contact.name,email:contact.email,company:contact.company || "",notes:contact.notes || "",phone:"513-555-0123",address:"123 Test Street\nCincinnati, OH"};
  assert.equal((await request("/api/clients",edit,bob.cookie)).status,404);
  assert.equal((await request("/api/clients",edit,alice.cookie)).status,200);
  const edited=(await request("/api/clients?id="+contact.id,null,alice.cookie)).data.contact;
  assert.equal(edited.phone,edit.phone);
  assert.equal(edited.address,edit.address);
  assert.equal((await request("/api/clients",{...edit,phone:"1".repeat(41)},alice.cookie)).status,400);

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
  const newEmail = "invited-new@example.com";
  const newInvite = await request("/api/teams", { action: "invite", organization, email: newEmail, role: "staff" }, alice.cookie);
  assert.equal(newInvite.status, 200, JSON.stringify(newInvite.data));
  const newToken = newInvite.data.invitationPath.split("token=")[1];
  const inspected = await request("/api/teams", { action: "inspect-invite", token: newToken });
  assert.equal(inspected.status, 200, JSON.stringify(inspected.data));
  assert.deepEqual(inspected.data, { email: newEmail, mode: "register" });
  const registration = { action: "register-invite", token: newToken, name: "Invited Teammate", password, email: "ignored@example.com" };
  const results = await Promise.all([request("/api/teams", registration), request("/api/teams", registration)]);
  assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.data)));
  assert.ok(results.some((r) => r.status === 403 || r.status === 409));
  assert.equal((await request("/api/teams", { action: "inspect-invite", token: newToken })).status, 403);
  const signedIn = await request("/api/auth", { action: "sign-in", email: newEmail, password });
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.data));
  const joined = await request("/api/teams?id=" + organization, null, signedIn.cookie);
  assert.equal(joined.status, 200, JSON.stringify(joined.data));
  assert.equal(joined.data.role, "staff");
  const fullEmail = "invite-no-seat@example.com";
  const fullInvite = await request("/api/teams", { action: "invite", organization, email: fullEmail, role: "staff" }, alice.cookie);
  assert.equal(fullInvite.status, 200);
  const fullToken = fullInvite.data.invitationPath.split("token=")[1];
  const full = await request("/api/teams", { ...registration, token: fullToken });
  assert.equal(full.status, 409, JSON.stringify(full.data));
  assert.match(full.data.error, /paid seat/);
  assert.equal((await db.query('SELECT 1 FROM public."user" WHERE email=$1', [fullEmail])).rowCount, 0);
  const invitedMember = joined.data.members.find((member) => member.email === newEmail);
  assert.equal((await request("/api/teams", { action: "remove", organization, user_id: invitedMember.user_id }, alice.cookie)).status, 200);
  const staffUsage = (await request("/api/usage", null, bob.cookie)).data;
  assert.equal(staffUsage.plan, "teams");
  // Teams envelopes are a pooled allowance: per-seat allowance × paid seats.
  assert.equal(staffUsage.limits.envelopes, 100 * staffUsage.shared[0].seats);
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
  // Role policies are owner-controlled and enforced on every request.
  assert.equal((await request("/api/teams",{action:"permissions",organization,role:"staff",permissions:["settings"]},alice.cookie)).status,200);
  assert.equal((await request("/api/teams",{action:"rename",organization,name:"Delegated fixture team"},bob.cookie)).status,200);
  assert.equal((await request("/api/teams",{action:"permissions",organization,role:"staff",permissions:["members"]},bob.cookie)).status,403);
  assert.equal((await request("/api/teams",{action:"role",organization,user_id:aid,role:"staff"},bob.cookie)).status,403);
  assert.equal((await request("/api/teams",{action:"permissions",organization,role:"staff",permissions:["billing"]},alice.cookie)).status,400);
  assert.equal((await request("/api/teams",{action:"permissions",organization,role:"staff",permissions:[]},alice.cookie)).status,200);
  assert.equal((await request("/api/teams",{action:"rename",organization,name:"Must not rename"},bob.cookie)).status,403);
  assert.equal((await request("/api/teams",{action:"role",organization,user_id:bid,role:"administrator"},alice.cookie)).status,200);
  assert.equal((await request("/api/teams",{action:"permissions",organization,role:"administrator",permissions:[]},alice.cookie)).status,200);
  assert.equal((await request("/api/teams",{action:"invite",organization,email:"no-manager-authority@example.com",role:"staff"},bob.cookie)).status,403);
  assert.equal((await request("/api/teams",{action:"permissions",organization,role:"administrator",permissions:["members","pages","appointments","settings","schedule"]},alice.cookie)).status,200);
  assert.equal((await request("/api/teams",{action:"role",organization,user_id:bid,role:"staff"},alice.cookie)).status,200);
  assert.equal((await request("/api/teams",{action:"role",organization,user_id:aid,role:"staff"},alice.cookie)).status,409);
  const masterTeam=await request("/api/teams",{action:"create",name:"Platform fixture team",slug:"platform-unlimited"},owner.cookie);
  assert.equal(masterTeam.status,200,JSON.stringify(masterTeam.data));
  for(let n=0;n<4;n++){
    const email=`platform-teammate-${n}@example.com`;
    const account=await signup(email,`Platform teammate ${n}`);
    assert.equal(account.status,200);
    const invitation=await request("/api/teams",{action:"invite",organization:masterTeam.data.id,email,role:"staff"},owner.cookie);
    assert.equal(invitation.status,200);
    const accepted=await request("/api/teams",{action:"accept",token:invitation.data.invitationPath.split("token=")[1]},account.cookie);
    assert.equal(accepted.status,200,JSON.stringify(accepted.data));
    const allowance=(await request("/api/usage",null,account.cookie)).data;
    assert.equal(allowance.plan,"team");
    assert.equal(allowance.unlimitedSeats,true);
  }
  const masterState=(await request("/api/teams?id="+masterTeam.data.id,null,owner.cookie)).data;
  assert.equal(masterState.occupied,5);
  assert.equal(masterState.seats,null);
  assert.equal(masterState.unlimitedSeats,true);
  const masterBilling=(await request("/api/billing",null,owner.cookie)).data;
  assert.equal(masterBilling.usage.plan,"team");
  assert.equal(masterBilling.usage.platformIncluded,true);
  assert.equal(masterBilling.usage.unlimitedSeats,true);
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
        { plan: "individual", period: "monthly", confirm: true },
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
  const schedulerHeaders = {
    Authorization: "Bearer " + process.env.CRON_SECRET,
  };
  const beforeProbe = (
    await db.query("SELECT count(*)::int n FROM private.job_runner_state")
  ).rows[0].n;
  const probe = await fetch(origin + "/api/jobs?probe=1", {
    headers: schedulerHeaders,
  });
  assert.equal(probe.status, 200);
  const probeData = await probe.json();
  assert.equal(probeData.configured, false);
  assert(!JSON.stringify(probeData).includes(process.env.CRON_SECRET));
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM private.job_runner_state"))
      .rows[0].n,
    beforeProbe,
    "Probe must not create or process runner state",
  );
  const scheduled = await fetch(origin + "/api/jobs", {
    headers: schedulerHeaders,
  });
  assert.equal(
    scheduled.status,
    503,
    "Fixture has no mail provider credentials",
  );
  const runnerState = (
    await db.query(
      "SELECT * FROM private.job_runner_state WHERE id='scheduled'",
    )
  ).rows[0];
  assert.equal(runnerState.last_error, "Email delivery is not configured.");
  assert.equal(runnerState.last_success_at, null);
  assert.equal(runnerState.locked_until, null);

  // Owner-only storefront switch preserves order access while blocking new shopping.
  assert.equal((await request("/api/admin/marketplace",{action:"visibility",visible:false},alice.cookie)).status,403);
  assert.equal((await request("/api/admin/marketplace",{action:"visibility",visible:false},owner.cookie)).status,200);
  assert.equal((await request("/api/marketplace")).status,404);
  assert.equal((await request("/api/marketplace",{lines:[]})).status,404);
  assert.equal((await fetch(origin+"/marketplace")).status,404);
  assert.equal((await fetch(origin+"/marketplace/orders",{headers:{Cookie:alice.cookie}})).status,200);
  assert.equal((await request("/api/workspace",null,alice.cookie)).data.marketplaceVisible,false);
  assert.equal((await request("/api/admin/marketplace",{action:"visibility",visible:true},owner.cookie)).status,200);
  assert.equal((await request("/api/marketplace")).status,200);

  // Private manual override bypasses published hours, never identity or conflicts.
  const manualEvent=(await db.query("INSERT INTO public.event_types(user_id,title,slug,duration,buffer) VALUES($1,'After hours','after-hours',30,15) RETURNING id",[aid])).rows[0];
  const manualDate=new Date(Date.now()+25*86400000);manualDate.setUTCHours(3,7,0,0);
  const manual={action:"create-appointment",event_id:manualEvent.id,starts_at:manualDate.toISOString(),name:"After Hours Client",email:"after-hours@example.com",answers:{},overrideAvailability:true,overrideConfirmed:true,overrideReason:"Client requested an evening appointment",location:"After-hours meeting room"};
  assert.equal((await request("/api/workspace",manual)).status,401);
  assert.equal((await request("/api/workspace",manual,bob.cookie)).status,404);
  assert.equal((await request("/api/workspace",{...manual,overrideConfirmed:false},alice.cookie)).status,400);
  assert.equal((await request("/api/workspace",manual,alice.cookie)).status,201);
  assert.equal((await request("/api/workspace",{...manual,email:"overlap@example.com"},alice.cookie)).status,409);
  assert.equal((await request("/api/book",{host:wa.profile.slug,event:"after-hours",starts_at:manual.starts_at,name:"Public Guest",email:"public-after@example.com",answers:{},overrideAvailability:true,overrideConfirmed:true})).status,409);
  assert.equal((await db.query("SELECT count(*)::int n FROM private.operation_log WHERE actor_id=$1 AND action='manual_booking_availability_override'",[aid])).rows[0].n,1);


  // Scheduling customization is enforced by the same transactional public slot function.
  const savedAvailability=(await request("/api/workspace",null,alice.cookie)).data;
  const customizeDays=savedAvailability.availability.map(d=>({...d,start_time:"09:00",end_time:"17:00",enabled:true,periods:[{start:"09:00",end:"12:00"},{start:"13:00",end:"17:00"}]}));
  const customDay=(await db.query("SELECT to_char((now() AT TIME ZONE timezone)::date+45,'YYYY-MM-DD') AS day_key FROM public.profiles WHERE id=$1",[aid])).rows[0].day_key;
  const customRules={noticeMinutes:0,horizonDays:60,intervalMinutes:30,exceptions:[]};
  assert.equal((await request("/api/workspace",{action:"availability",days:customizeDays},alice.cookie)).status,200);
  assert.equal((await request("/api/workspace",{action:"availability-rules",rules:{...customRules,intervalMinutes:0}},alice.cookie)).status,400);
  const initialRulesSave=await request("/api/workspace",{action:"availability-rules",rules:customRules},alice.cookie);
  assert.equal(initialRulesSave.status,200,JSON.stringify(initialRulesSave.data));
  const customizedSlots=async()=> (await db.query("SELECT starts_at,to_char(starts_at AT TIME ZONE $4,'HH24:MI') local_time FROM public.public_slots($1,$2,$3)",[wa.profile.slug,"after-hours",customDay,wa.profile.timezone])).rows;
  let customSlots=await customizedSlots();
  assert.ok(customSlots.some(s=>s.local_time==="09:00"));
  assert.ok(customSlots.some(s=>s.local_time==="13:00"));
  assert.ok(!customSlots.some(s=>s.local_time>="12:00"&&s.local_time<"13:00"),"Lunch break must not offer slots");
  assert.equal((await request("/api/workspace",{action:"availability-rules",rules:{...customRules,horizonDays:1}},alice.cookie)).status,200);
  assert.equal((await customizedSlots()).length,0,"Booking horizon applies to public availability");
  assert.equal((await request("/api/workspace",{action:"availability-rules",rules:{...customRules,exceptions:[{date:customDay,periods:[]}]}},alice.cookie)).status,200);
  assert.equal((await customizedSlots()).length,0,"Date closure overrides weekly hours");
  assert.equal((await request("/api/workspace",{action:"availability-rules",rules:{...customRules,exceptions:[{date:customDay,periods:[{start:"19:00",end:"20:00"}]}]}},alice.cookie)).status,200);
  customSlots=await customizedSlots();assert.equal(customSlots.length,2);
  const normalLocation=await request("/api/workspace",{action:"create-appointment",event_id:manualEvent.id,starts_at:new Date(customSlots[0].starts_at).toISOString(),name:"Location Guest",email:"location-fixture@example.com",location:"120 Main Street, Suite 5",answers:{}},alice.cookie);
  assert.equal(normalLocation.status,201,JSON.stringify(normalLocation.data));
  const locationBooking=(await db.query("SELECT id,location FROM public.bookings WHERE user_id=$1 AND guest_email='location-fixture@example.com'",[aid])).rows[0];
  assert.equal(locationBooking.location,"120 Main Street, Suite 5");
  const calendarLocation=await request("/api/calendar?from="+encodeURIComponent(new Date(customSlots[0].starts_at).toISOString())+"&to="+encodeURIComponent(new Date(+new Date(customSlots[0].starts_at)+86400000).toISOString()),null,alice.cookie);
  assert.equal(calendarLocation.data.events.find(e=>e.id===locationBooking.id).location,"120 Main Street, Suite 5");
  assert.equal((await request("/api/workspace",{action:"availability",days:savedAvailability.availability.map(d=>({...d,start_time:d.start_time.slice(0,5),end_time:d.end_time.slice(0,5)}))},alice.cookie)).status,200);
  assert.equal((await request("/api/workspace",{action:"availability-rules",rules:savedAvailability.profile.availability_rules},alice.cookie)).status,200);

  // A covered team seat is nested, while a member's independently billed plan stays a root.
  assert.equal((await request("/api/admin/subscriptions",{action:"grant",userId:aid,plan:"team",expires:new Date(Date.now()+30*86400000).toISOString(),reason:"Isolated grouping fixture"},owner.cookie)).status,200);
  const groupedChild=crypto.randomUUID();
  await db.query('INSERT INTO public."user"(id,name,email) VALUES($1,$2,$3)',[groupedChild,"Grouped Team Member","grouped-team-member@example.com"]);
  await db.query("INSERT INTO private.memberships(organization_id,user_id,role,active) VALUES($1,$2,'staff',true)",[organization,groupedChild]);
  let groupedList=(await request("/api/admin/subscriptions?search=grouped-team-member",null,owner.cookie)).data;
  assert.ok(groupedList.accounts.find(a=>a.user_id===aid)?.team_members.some(m=>m.user_id===groupedChild));
  assert.ok(!groupedList.accounts.some(a=>a.user_id===groupedChild));
  await db.query("INSERT INTO private.subscriptions(user_id,plan,status,subscription_id) VALUES($1,'individual','active','sub_grouped_independent_fixture') ON CONFLICT(user_id) DO UPDATE SET plan='individual',status='active',subscription_id='sub_grouped_independent_fixture'",[groupedChild]);
  groupedList=(await request("/api/admin/subscriptions?search=grouped-team-member",null,owner.cookie)).data;
  assert.ok(groupedList.accounts.some(a=>a.user_id===groupedChild),"An independent personal subscription must remain separately manageable");
  await db.query("UPDATE private.subscriptions SET status='canceled' WHERE user_id=$1",[groupedChild]);
  groupedList=(await request("/api/admin/subscriptions?search=grouped-team-member",null,owner.cookie)).data;
  assert.ok(groupedList.accounts.find(a=>a.user_id===aid)?.team_members.some(m=>m.user_id===groupedChild),"An old canceled subscription must not hide a covered team seat");
  await db.query("UPDATE private.memberships SET active=false WHERE organization_id=$1 AND user_id=$2",[organization,groupedChild]);

  console.log(
    "PASS upgrade integration: migrations, ownership, required intake snapshots, immutable reschedule IDs and reminder cancellation, encrypted per-recipient delivery, template versions, client links, workflow permissions, team invitations and shared reservations, provider/payment gates, and admin isolation.",
  );
} finally {
  await db.end();
}
