import { test } from "node:test";
import assert from "node:assert/strict";
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
const errors = load("src/lib/resend-diagnostics.ts", {
  "./db": {},
  "./platform-settings": {},
});
test("provider errors give actionable fixed messages without reflecting recipients, links or keys", () => {
  const samples = [
    [
      403,
      {
        name: "validation_error",
        message:
          "You can only send testing emails to private@example.com; https://site/sign#token=secret",
      },
      "test_sender_restricted",
    ],
    [
      403,
      {
        name: "validation_error",
        message: "The private-domain.com domain is not verified",
      },
      "sender_domain_unverified",
    ],
    [
      401,
      { name: "validation_error", message: "API key is invalid re_secret" },
      "api_key_rejected",
    ],
    [
      403,
      { name: "restricted_api_key", message: "API key is not active" },
      "api_key_rejected",
    ],
    [429, { name: "rate_limit_exceeded" }, "provider_rate_limited"],
    [409, { name: "invalid_idempotent_request" }, "idempotency_conflict"],
  ];
  for (const [status, body, code] of samples) {
    const error = errors.resendFailure(status, body);
    assert.equal(error.code, code);
    assert(!/private@|private-domain|re_secret|token=/.test(error.message));
  }
  assert(errors.resendFailure(500, {}).retryable);
});
test("provider diagnostics compare exact sender domain and distinguish sending-only keys without sending", async () => {
  const old = globalThis.fetch;
  let calls = 0;
  const module = load("src/lib/resend-diagnostics.ts", {
    "./db": { getPool: () => ({ query: async () => ({ rows: [] }) }) },
    "./platform-settings": {
      integrationValue: async (name) =>
        name === "RESEND_API_KEY" ? "fixture-key" : "Zenvio <mail@example.com>",
    },
  });
  try {
    globalThis.fetch = async (url, options) => {
      calls++;
      assert(url.startsWith("https://api.resend.com/domains?"));
      assert.equal(options.method, undefined);
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              name: "example.com",
              status: "verified",
              capabilities: { sending: "enabled" },
            },
          ],
        }),
      };
    };
    const status = await module.emailDiagnostics();
    assert.equal(status.domainStatus, "verified");
    assert.equal(status.credentialStatus, "accepted");
    assert(!JSON.stringify(status).includes("fixture-key"));
    assert(!JSON.stringify(status).includes("mail@example.com"));
    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        name: "restricted_api_key",
        message: "This API key is restricted to only send emails.",
      }),
    });
    const limited = await module.emailDiagnostics();
    assert.equal(limited.credentialStatus, "sending_only");
    assert.equal(limited.issue, null);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = old;
  }
});
test("account delivery reports provider rejection and normalizes configured values without rotating credentials", async () => {
  const old = globalThis.fetch;
  let sent;
  const mail = load("src/lib/mail.ts", {
    "./platform-settings": {
      integrationValue: async (name) =>
        name === "RESEND_API_KEY"
          ? " fixture-key "
          : " Zenvio <mail@example.com> ",
    },
    "./resend-diagnostics": errors,
  });
  try {
    globalThis.fetch = async (url, options) => {
      sent = options;
      return {
        ok: false,
        status: 403,
        json: async () => ({
          name: "validation_error",
          message: "The example.com domain is not verified",
        }),
      };
    };
    await assert.rejects(
      mail.sendAccountMail(
        "recipient@example.com",
        "Fixture",
        "https://example.com/private",
      ),
      (e) => e.code === "sender_domain_unverified",
    );
    assert.equal(sent.headers.Authorization, "Bearer fixture-key");
    assert.equal(JSON.parse(sent.body).from, "Zenvio <mail@example.com>");
  } finally {
    globalThis.fetch = old;
  }
});
test("signup verification checks the integration vault at send time without changing existing sign-in policy", async () => {
  let config,
    sent = 0,
    ready = true;
  const auth = load("src/lib/auth.ts", {
    "better-auth": {
      betterAuth: (v) => {
        config = v;
        return {};
      },
    },
    "better-auth/next-js": { nextCookies: () => ({}) },
    "./db": { getPool: () => ({}) },
    "./mail": {
      mailReady: async () => ready,
      sendAccountMail: async () => {
        sent++;
      },
    },
  });
  auth.getAuth();
  assert.equal(config.emailVerification.sendOnSignUp, true);
  await config.emailVerification.sendVerificationEmail({
    user: { email: "fixture@example.com" },
    url: "https://example.com/verify",
  });
  assert.equal(sent, 1);
  ready = false;
  await config.emailVerification.sendVerificationEmail({
    user: { email: "fixture@example.com" },
    url: "https://example.com/verify",
  });
  assert.equal(sent, 1);
});
