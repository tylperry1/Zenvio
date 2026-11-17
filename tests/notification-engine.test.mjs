import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

function load(file, deps = {}) {
  const filename = path.resolve(file);
  const m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = m.require.bind(m);
  m.require = (id) => {
    if (Object.hasOwn(deps, id)) return deps[id];
    if (id.startsWith(".")) {
      const base = path.resolve(path.dirname(filename), id);
      const target = fs.existsSync(base)
        ? base
        : fs.existsSync(base + ".ts")
          ? base + ".ts"
          : fs.existsSync(base + ".js")
            ? base + ".js"
            : null;
      if (target?.endsWith(".ts")) return load(target, deps);
    }
    return original(id);
  };
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

test("migration 088 defines notification envelopes and channel attempts", () => {
  const sql = fs.readFileSync("postgres/migrations/088_notification_engine.sql", "utf8");
  assert.match(sql, /CREATE TABLE private\.notifications/);
  assert.match(sql, /CREATE TABLE private\.notification_attempts/);
  assert.match(sql, /CREATE TABLE private\.notification_preferences/);
  assert.match(sql, /notification_attempt_id/);
  assert.match(sql, /'queued', 'scheduled', 'processing', 'accepted', 'delivered', 'failed', 'canceled', 'suppressed'/);
  assert.match(sql, /channel text NOT NULL CHECK \(channel IN \('email', 'sms', 'push'\)\)/);
  assert.match(sql, /UPDATE private\.notifications/);
  assert.match(sql, /lifecycle_booking/);
});

test("channel preferences distinguish marketing vs transactional", () => {
  const prefs = load("src/lib/notifications/preferences.ts");
  const base = {
    emailTransactional: true,
    emailMarketing: false,
    smsAppointment: true,
    smsMarketing: false,
    pushEnabled: false,
  };
  assert.equal(prefs.channelAllowedByPreference(base, "email", "appointment_reminder"), true);
  assert.equal(prefs.channelAllowedByPreference(base, "email", "marketing"), false);
  assert.equal(prefs.channelAllowedByPreference(base, "sms", "appointment_confirmation"), true);
  assert.equal(prefs.channelAllowedByPreference(base, "sms", "marketing"), false);
  assert.equal(prefs.channelAllowedByPreference(base, "push", "appointment_reminder"), false);
  assert.equal(
    prefs.channelAllowedByPreference({ ...base, pushEnabled: true }, "push", "appointment_reminder"),
    true,
  );
});

test("SMS adapter suppresses when production SMS flag is off", async () => {
  const previous = process.env.TELNYX_MESSAGING_ENABLED;
  process.env.TELNYX_MESSAGING_ENABLED = "false";
  try {
    const adapters = load("src/lib/notifications/adapters.ts", {
      "../sms": {
        normalizePhone: (v) => (v.startsWith("+") ? v : null),
        smsReadiness: async () => {
          throw new Error("should not readiness-check when disabled");
        },
        smsTransport: () => ({
          send: async () => {
            throw new Error("should not send");
          },
        }),
      },
    });
    const result = await adapters.dispatchSmsAttempt(
      {},
      { workspaceId: "ws", channels: ["sms"] },
      { to: "+15551234567", body: "Hello", reference: "sms-test-reference-01" },
    );
    assert.equal(result.status, "suppressed");
    assert.equal(result.failureClass, "provider_disabled");
    assert.match(result.failureReason, /TELNYX_MESSAGING_ENABLED/);
  } finally {
    if (previous === undefined) delete process.env.TELNYX_MESSAGING_ENABLED;
    else process.env.TELNYX_MESSAGING_ENABLED = previous;
  }
});

test("push adapter is stubbed as not_implemented without claiming delivery", async () => {
  const adapters = load("src/lib/notifications/adapters.ts", {
    "../sms": {
      normalizePhone: () => null,
      smsReadiness: async () => ({ ok: false }),
      smsTransport: () => ({ send: async () => ({ status: "failed", providerId: null }) }),
    },
  });
  const result = await adapters.dispatchPushAttempt({}, { workspaceId: "ws", channels: ["push"] }, {
    title: "Hi",
    body: "There",
  });
  assert.equal(result.status, "suppressed");
  assert.equal(result.failureClass, "not_implemented");
  assert.equal(result.provider, "firebase");
});

test("enqueueNotification is idempotent and isolates channel failures", async () => {
  const previous = process.env.TELNYX_MESSAGING_ENABLED;
  process.env.TELNYX_MESSAGING_ENABLED = "false";
  const inserts = [];
  const updates = [];
  const db = {
    query: async (sql, args = []) => {
      if (sql.includes("FROM private.notifications WHERE workspace_id")) {
        if (inserts.some((row) => row[7] === args[1])) {
          return { rows: [{ id: "n1", status: "queued" }] };
        }
        return { rows: [] };
      }
      if (sql.includes("FROM private.notification_preferences")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO private.notifications")) {
        inserts.push(args);
        return { rows: [{ id: "n1", status: args[6] }] };
      }
      if (sql.includes("INSERT INTO private.notification_attempts")) {
        inserts.push(["attempt", ...args]);
        return { rows: [] };
      }
      if (sql.includes("UPDATE private.notifications")) {
        updates.push(args);
        return { rows: [] };
      }
      if (sql.includes("UPDATE private.delivery_jobs")) {
        return { rows: [] };
      }
      if (sql.includes("FROM private.notification_attempts WHERE notification_id")) {
        return {
          rows: [
            { channel: "email", status: "queued", provider: "resend" },
            { channel: "push", status: "suppressed", provider: "firebase", failure_class: "not_implemented" },
          ],
        };
      }
      return { rows: [] };
    },
  };

  let emailed = 0;
  const engine = load("src/lib/notifications/engine.ts", {
    "./adapters": {
      dispatchEmailAttempt: async (_db, _input, email) => {
        emailed += 1;
        return { channel: "email", status: "queued", provider: "resend", deliveryJobKey: email.key };
      },
      dispatchSmsAttempt: async () => ({
        channel: "sms",
        status: "suppressed",
        failureClass: "provider_disabled",
        failureReason: "off",
      }),
      dispatchPushAttempt: async () => ({
        channel: "push",
        status: "suppressed",
        failureClass: "not_implemented",
        provider: "firebase",
      }),
    },
    "./preferences": load("src/lib/notifications/preferences.ts"),
  });

  const first = await engine.enqueueNotification(db, {
    workspaceId: "11111111-1111-1111-1111-111111111111",
    idempotencyKey: "notify:reminder:b1:0:60",
    category: "appointment_reminder",
    channels: ["email", "sms", "push"],
    email: {
      kind: "booking_reminder",
      key: "reminder:b1:0:60",
      to: "guest@example.com",
      subject: "Reminder",
      text: "Soon",
    },
    sms: { to: "+15551234567", body: "Soon", reference: "sms-reminder-b1-0-60xx" },
    push: { title: "Reminder", body: "Soon" },
  });
  assert.equal(first.deduped, false);
  assert.equal(emailed, 1);
  assert.equal(first.attempts.length, 3);
  assert.equal(first.attempts.find((a) => a.channel === "email").status, "queued");
  assert.equal(first.attempts.find((a) => a.channel === "sms").status, "suppressed");
  assert.equal(first.attempts.find((a) => a.channel === "push").status, "suppressed");

  const second = await engine.enqueueNotification(db, {
    workspaceId: "11111111-1111-1111-1111-111111111111",
    idempotencyKey: "notify:reminder:b1:0:60",
    category: "appointment_reminder",
    channels: ["email", "sms", "push"],
    email: {
      kind: "booking_reminder",
      key: "reminder:b1:0:60",
      to: "guest@example.com",
      subject: "Reminder",
      text: "Soon",
    },
  });
  assert.equal(second.deduped, true);
  assert.equal(emailed, 1);

  if (previous === undefined) delete process.env.TELNYX_MESSAGING_ENABLED;
  else process.env.TELNYX_MESSAGING_ENABLED = previous;
});

test("scheduleBooking routes through the notification engine", () => {
  const source = fs.readFileSync("src/lib/lifecycle.ts", "utf8");
  assert.match(source, /notifications\/engine/);
  assert.match(source, /enqueueNotification/);
  assert.match(source, /appointment_reminder/);
  assert.match(source, /appointment_confirmation/);
  assert.match(source, /email_outbox/);
});
