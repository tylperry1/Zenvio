import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";
function load(file, overrides = {}) {
  const filename = path.resolve(file),
    m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const standard = m.require.bind(m);
  m.require = (id) =>
    id === "./entitlements"
      ? {}
      : Object.hasOwn(overrides, id)
        ? overrides[id]
        : standard(id);
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
const errors = load("src/lib/google-calendar-errors.ts");
test("calendar diagnostics distinguish disabled API, missing scope, throttling, and missing calendars without leaking Google payloads", () => {
  const issue = errors.calendarIssue(403, {
    error: {
      details: [
        {
          reason: "SERVICE_DISABLED",
          metadata: { consumer: "secret-project" },
        },
      ],
      message: "sensitive provider body",
    },
  });
  assert.equal(issue.code, "api_disabled");
  assert(!JSON.stringify(issue).includes("secret-project"));
  assert(!JSON.stringify(issue).includes("sensitive"));
  assert.equal(
    errors.calendarIssue(403, {
      error: { errors: [{ reason: "insufficientPermissions" }] },
    }).code,
    "permissions_missing",
  );
  assert.equal(
    errors.calendarIssue(403, {
      error: { errors: [{ reason: "rateLimitExceeded" }] },
    }).code,
    "rate_limited",
  );
  assert.equal(errors.calendarIssue(404).code, "calendar_missing");
});
class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
function fixture() {
  const queries = [];
  let refreshes = 0;
  const row = {
    user_id: "owner",
    account_sub: "account",
    status: "connected",
    access_ciphertext: "old",
    refresh_ciphertext: "refresh",
    expires_at: new Date(Date.now() + 3600000),
  };
  const client = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.startsWith("SELECT *")) return { rows: [row] };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const pool = { ...client, connect: async () => client };
  const service = load("src/lib/google-calendar.ts", {
    "./db": { getPool: () => pool },
    "./server": { ApiError },
    "./platform-settings": {
      integrationValue: async () => "test",
      sealSecret: (v) => v,
      unsealSecret: (v) => v,
    },
    "./google-calendar-errors": errors,
    "google-auth-library": {
      OAuth2Client: class {
        setCredentials() {}
        async refreshAccessToken() {
          refreshes++;
          return {
            credentials: {
              access_token: "fresh",
              expiry_date: Date.now() + 3600000,
            },
          };
        }
      },
    },
  });
  return { service, queries, refreshes: () => refreshes };
}
test("availability retries an unexpected 401 with a refreshed token before marking access revoked", async () => {
  const f = fixture(),
    original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    if (calls === 1) return Response.json({ error: {} }, { status: 401 });
    assert.equal(options.headers.Authorization, "Bearer fresh");
    return Response.json({ calendars: { primary: { busy: [] } } });
  };
  try {
    const r = await f.service.checkGoogleConnection("owner", "account");
    assert.equal(r.ok, true);
    assert.equal(calls, 2);
    assert.equal(f.refreshes(), 1);
    assert(
      !f.queries.some((q) => q.sql.includes("status='reconnect_required'")),
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("availability saves an actionable account-specific failure without treating a disabled API as busy-free", async () => {
  const f = fixture(),
    original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(
      { error: { details: [{ reason: "SERVICE_DISABLED" }] } },
      { status: 403 },
    );
  try {
    const r = await f.service.checkGoogleConnection("owner", "account");
    assert.equal(r.ok, false);
    assert.equal(r.code, "api_disabled");
    const saved = f.queries.find((q) => q.sql.includes("SET last_error=$3"));
    assert.deepEqual(saved.params.slice(0, 2), ["owner", "account"]);
    assert(saved.params[2].includes("same project"));
  } finally {
    globalThis.fetch = original;
  }
});
test("checking an account owned by someone else never calls Google", async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw Error("unexpected");
  };
  const service = load("src/lib/google-calendar.ts", {
    "./db": {
      getPool: () => ({ query: async () => ({ rows: [], rowCount: 0 }) }),
    },
    "./server": { ApiError },
    "./platform-settings": {},
    "./google-calendar-errors": errors,
  });
  try {
    await assert.rejects(
      service.checkGoogleConnection("owner", "foreign"),
      (e) => e.status === 404,
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});
test("one failing account blocks public availability and hides owner-only diagnostics", async () => {
  const original = globalThis.fetch;
  const f = fixture();
  let calls = 0;
  const rows = [
    { id: "owner", account_sub: "first" },
    { id: "owner", account_sub: "second" },
  ];
  const client = {
    query: async (sql) =>
      sql.startsWith("SELECT *")
        ? {
            rows: [
              {
                status: "connected",
                access_ciphertext: "access",
                expires_at: new Date(Date.now() + 3600000),
                account_sub: calls === 0 ? "first" : "second",
              },
            ],
          }
        : { rows: [] },
    release() {},
  };
  const service = load("src/lib/google-calendar.ts", {
    "./db": {
      getPool: () => ({
        query: async (sql) =>
          sql.startsWith("SELECT p.id") ? { rows } : { rows: [] },
        connect: async () => client,
      }),
    },
    "./server": { ApiError },
    "./platform-settings": { unsealSecret: (x) => x },
    "./google-calendar-errors": errors,
  });
  globalThis.fetch = async () => {
    calls++;
    return calls === 1
      ? Response.json({ calendars: { primary: { busy: [] } } })
      : Response.json(
          { error: { details: [{ reason: "SERVICE_DISABLED" }] } },
          { status: 403 },
        );
  };
  try {
    await assert.rejects(
      service.googleBusyForHost(
        "host",
        "2026-11-01T00:00:00Z",
        "2026-11-02T00:00:00Z",
      ),
      (e) => e.status === 503 && !e.message.includes("project"),
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});
