import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import ts from "typescript";
function load(file, overrides = {}) {
  const filename = path.resolve(file),
    m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const require = m.require.bind(m);
  m.require = (id) =>
    Object.hasOwn(overrides, id) ? overrides[id] : require(id);
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
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  }),
  jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: "fixture-key",
    alg: "RS256",
    use: "sig",
  };
function claims() {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "https://token.actions.githubusercontent.com",
    aud: "https://gozenvio.com/api/jobs",
    sub: "repo:tylperry1@222509539/Zenvio@1433734869:ref:refs/heads/main",
    repository: "tylperry1/Zenvio",
    repository_id: "1433734869",
    repository_owner_id: "222509539",
    ref: "refs/heads/main",
    workflow_ref:
      "tylperry1/Zenvio/.github/workflows/scheduled-jobs.yml@refs/heads/main",
    event_name: "schedule",
    runner_environment: "github-hosted",
    iat: now,
    nbf: now - 1,
    exp: now + 300,
  };
}
function token(
  payload,
  header = { alg: "RS256", typ: "JWT", kid: "fixture-key" },
) {
  const body = [header, payload]
    .map((x) => Buffer.from(JSON.stringify(x)).toString("base64url"))
    .join(".");
  return (
    body +
    "." +
    sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url")
  );
}
test("scheduler preserves cron credentials and restricts signed OIDC to the exact main workflow and repository", async () => {
  const previous = {
      provider: process.env.JOB_SCHEDULER_PROVIDER,
      cron: process.env.CRON_SECRET,
    },
    original = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async (url) => {
    assert.equal(
      url,
      "https://token.actions.githubusercontent.com/.well-known/jwks",
    );
    fetched++;
    return { ok: true, json: async () => ({ keys: [jwk] }) };
  };
  process.env.JOB_SCHEDULER_PROVIDER = "github-actions";
  process.env.CRON_SECRET = "fixture-existing-cron";
  const auth = load("src/lib/job-authorization.ts");
  try {
    assert(await auth.jobsAuthorized("Bearer fixture-existing-cron"));
    assert(!(await auth.jobsAuthorized(null)));
    assert(await auth.jobsAuthorized("Bearer " + token(claims())));
    assert.equal(fetched, 1);
    const legacy = {
      ...claims(),
      sub: "repo:tylperry1/Zenvio:ref:refs/heads/main",
    };
    assert(await auth.jobsAuthorized("Bearer " + token(legacy)));
    for (const change of [
      { aud: "other" },
      { repository_id: "wrong" },
      { repository_owner_id: "wrong" },
      { ref: "refs/heads/other" },
      {
        workflow_ref:
          "tylperry1/Zenvio/.github/workflows/other.yml@refs/heads/main",
      },
      { event_name: "pull_request" },
      { runner_environment: "self-hosted" },
      { sub: "repo:attacker/other:ref:refs/heads/main" },
      { exp: 0 },
      { iat: 1 },
      { nbf: Date.now() / 1000 + 3600 },
    ])
      assert(
        !(await auth.jobsAuthorized(
          "Bearer " + token({ ...claims(), ...change }),
        )),
      );
    assert(
      !(await auth.jobsAuthorized(
        "Bearer " +
          token(claims(), { alg: "none", typ: "JWT", kid: "fixture-key" }),
      )),
    );
    const forged = token(claims()).split(".");
    forged[1] = Buffer.from(
      JSON.stringify({ ...claims(), jti: "tampered" }),
    ).toString("base64url");
    assert(!(await auth.jobsAuthorized("Bearer " + forged.join("."))));
    assert(
      !(await auth.jobsAuthorized(
        "Bearer " +
          token(claims(), { alg: "RS256", typ: "JWT", kid: "missing" }),
      )),
    );
    assert.equal(fetched, 1);
    delete process.env.JOB_SCHEDULER_PROVIDER;
    assert(!(await auth.jobsAuthorized("Bearer " + token(claims()))));
    assert(await auth.jobsAuthorized("Bearer fixture-existing-cron"));
  } finally {
    globalThis.fetch = original;
    for (const [name, value] of [
      ["JOB_SCHEDULER_PROVIDER", previous.provider],
      ["CRON_SECRET", previous.cron],
    ])
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  }
});
function runnerFixture({ busy = false, configured = true } = {}) {
  const operations = [];
  const pool = {
    query: async (sql, args) => {
      operations.push({ sql, args });
      if (sql.startsWith("INSERT")) return { rows: [], rowCount: busy ? 0 : 1 };
      if (sql.startsWith("SELECT"))
        return {
          rows: [{ last_success_at: new Date(), last_error: null }],
          rowCount: 1,
        };
      return { rows: [], rowCount: 1 };
    },
  };
  const call = (name) => async () => {
    operations.push(name);
  };
  return {
    operations,
    runner: load("src/lib/job-runner.ts", {
      "./launch/classes": {drainClassCancellations:call("class-cancellations")},
      "./launch/waitlists": {materializeWaitlistOffers:call("waitlist-offers")},
      "./launch/sms-outbox": { drainSmsOutbox: call("sms-outbox"), materializeSmsReminders: call("sms-reminders") },
      "./db": { getPool: () => pool },
      "./mail": {
        mailReady: async () => configured,
        materializeBookingNotifications: call("booking-notifications"),
      },
      "./google-calendar": { drainCalendarCleanup: call("calendar-cleanup"),runGoogleJobs:call("google-sync") },
      "./microsoft-calendar": {runMicrosoftJobs:call("microsoft-sync")},
      "./workflows": { scheduleWorkflows: call("workflows") },
      "./gelato/follow-up": { processMarketplaceJobs: call("marketplace") },
      "./market-mail": { deliverMarketEmails: call("market-emails") },
      "./lifecycle": {
        purgeExpiredDeliverySecrets: call("purge"),
        materializeReminders: call("reminders"),
        drainDeliveries: async (user, limit) => {
          assert.equal(user, undefined);
          assert.equal(limit, 20);
          operations.push("delivery");
          return { configured, sent: configured ? 2 : 0 };
        },
      },
    }),
  };
}
test("scheduler lease prevents overlapping runs without touching delivery jobs", async () => {
  const { runner, operations } = runnerFixture({ busy: true });
  const result = await runner.processScheduledJobs();
  assert(result.busy);
  assert.equal(operations.length, 1);
  assert(operations[0].sql.includes("locked_until<=now()"));
});
test("scheduler records bounded successful work and never labels missing mail configuration healthy", async () => {
  const good = runnerFixture();
  assert.equal((await good.runner.processScheduledJobs()).sent, 2);
  assert.deepEqual(
    good.operations.filter((x) => typeof x === "string"),
    [
      "sms-reminders",
      "sms-outbox",
      "class-cancellations",
      "calendar-cleanup",
      "google-sync",
      "microsoft-sync",
      "purge",
      "booking-notifications",
      "reminders",
      "workflows",
      "waitlist-offers",
      "marketplace",
      "market-emails",
      "delivery",
    ],
  );
  assert(good.operations.at(-1).sql.includes("last_success_at=now()"));
  const failed = runnerFixture({ configured: false });
  await assert.rejects(
    failed.runner.processScheduledJobs(),
    /mail_unconfigured/,
  );
  assert(failed.operations.at(-1).sql.includes("last_error=$2"));
  assert.equal(
    failed.operations.at(-1).args[1],
    "Email delivery is not configured.",
  );
});
