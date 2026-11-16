import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import ts from "typescript";

function load(file, deps) {
  const filename = path.resolve(file);
  const m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = m.require.bind(m);
  m.require = (id) => (Object.hasOwn(deps, id) ? deps[id] : original(id));
  m._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  );
  return m.exports;
}

class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const referrals = load("src/lib/referrals.ts", {
  "./db": { getPool: () => ({ query: async () => ({ rows: [], rowCount: 0 }) }) },
  "./server": { ApiError },
  "./subscription-usage": { usageOwner: async (_db, user) => user },
  "./transactional-email": { platformOrigin: () => "https://gozenvio.com" },
});

const {
  normalizeReferralCode,
  defaultReferralCode,
  referralSharePath,
  rewardReference,
  redeemReferralOnSignup,
  rewardReferralOnPaidSubscription,
  REFERRAL_REWARD_METERS,
} = referrals;

test("normalizeReferralCode lowercases, trims, and rejects invalid shapes", () => {
  assert.equal(normalizeReferralCode("  Jamie Studio  "), "jamie-studio");
  assert.equal(normalizeReferralCode("Jamie_Studio"), "jamie_studio");
  assert.equal(normalizeReferralCode("a"), null);
  assert.equal(normalizeReferralCode(""), null);
  assert.equal(normalizeReferralCode(12), null);
  assert.equal(normalizeReferralCode("!!!"), null);
});

test("defaultReferralCode strips host- prefix from profile slugs", () => {
  const code = defaultReferralCode("host-abcdef123456");
  assert.match(code, /^[a-z0-9][a-z0-9_-]{1,39}$/);
  assert.ok(!code.startsWith("host-"));
});

test("defaultReferralCode keeps collision suffix after max-length truncation", () => {
  const longSeed = "a".repeat(48);
  const code = defaultReferralCode(longSeed, "2");
  assert.ok(code.endsWith("-2"));
  assert.equal(normalizeReferralCode(code), code);
  assert.ok(code.length <= 40);
});

test("referral share path encodes the code", () => {
  assert.equal(referralSharePath("jamie-studio"), "/sign-up?ref=jamie-studio");
});

test("in-app referrals page keeps share and regenerate actions", () => {
  const page = fs.readFileSync("src/components/referrals-center.tsx", "utf8");
  assert.match(page, /referrals-hero/);
  assert.match(page, /ShareLinkActions/);
  assert.match(page, /action: "regenerate"/);
  assert.match(page, /People you invited/);
});

test("self-referral is rejected", async () => {
  const owner = "11111111-1111-4111-8111-111111111111";
  const db = {
    query: async (sql, args) => {
      if (sql.includes("FROM private.referral_redemptions WHERE referee_user_id")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM private.referral_codes WHERE code")) {
        return { rows: [{ id: "code-1", owner_user_id: owner, active: true, max_redemptions: null }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  await assert.rejects(() => redeemReferralOnSignup(owner, "jamie-studio", db), (e) => e.status === 409);
});

test("already attributed referee cannot redeem again", async () => {
  const db = {
    query: async (sql) => {
      if (sql.includes("FROM private.referral_redemptions WHERE referee_user_id")) {
        return { rows: [{ id: "r1", status: "pending" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  await assert.rejects(
    () => redeemReferralOnSignup("22222222-2222-4222-8222-222222222222", "jamie-studio", db),
    (e) => e.status === 409,
  );
});

test("rewardReferralOnPaidSubscription grants credits once and stays idempotent", async () => {
  const redemption = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    referrer_user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    status: "pending",
    reward_reference: null,
  };
  const inserts = [];
  const updates = [];
  const db = {
    query: async (sql, args) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM private.referral_redemptions WHERE referee_user_id")) {
        return { rows: [{ ...redemption }], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO private.subscription_credit_entries")) {
        const reference = args[3];
        if (inserts.includes(reference)) return { rows: [], rowCount: 0 };
        inserts.push(reference);
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE private.referral_redemptions SET status='qualified'")) {
        redemption.status = "qualified";
        updates.push("qualified");
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE private.referral_redemptions SET status='rewarded'")) {
        redemption.status = "rewarded";
        redemption.reward_reference = args[1];
        updates.push("rewarded");
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO private.operation_log")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };

  const first = await rewardReferralOnPaidSubscription(db, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  assert.equal(first.rewarded, true);
  assert.equal(inserts.length, REFERRAL_REWARD_METERS.length);
  assert.deepEqual(
    inserts.sort(),
    REFERRAL_REWARD_METERS.map((r) => rewardReference(redemption.id, r.meter)).sort(),
  );
  assert.ok(updates.includes("qualified"));
  assert.ok(updates.includes("rewarded"));

  const second = await rewardReferralOnPaidSubscription(db, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  assert.equal(second.rewarded, false);
  assert.equal(inserts.length, REFERRAL_REWARD_METERS.length);
});
