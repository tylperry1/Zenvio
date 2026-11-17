import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";

/** Mirrors admin_account_detail role/protected fields from a platform_roles join row. */
function detailRoleFields(platformRole) {
  if (!platformRole) return { role: "member", protected: false };
  return {
    role: platformRole.enabled ? platformRole.role : "member",
    protected: true,
  };
}

function load(file, deps = {}) {
  const filename = path.resolve(file);
  const m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = m.require.bind(m);
  m.require = (id) => (Object.hasOwn(deps, id) ? deps[id] : original(id));
  m._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );
  return m.exports;
}

const MASTER = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const DISABLED = "33333333-3333-4333-8333-333333333333";

test("admin account detail migration separates display role from protect flag", () => {
  const sql = fs.readFileSync("postgres/migrations/081_admin_account_detail_role.sql", "utf8");
  assert.match(sql, /admin_account_detail/);
  assert.match(sql, /platform_roles/);
  assert.match(sql, /'role',\s*CASE WHEN r\.enabled THEN r\.role ELSE 'member' END/);
  assert.match(sql, /'protected',\s*\(r\.user_id IS NOT NULL\)/);
  assert.match(sql, /industry/);
});

test("admin_account_detail role mapping for enabled master, member, and disabled platform row", () => {
  assert.deepEqual(detailRoleFields({ role: "master_admin", enabled: true }), {
    role: "master_admin",
    protected: true,
  });
  assert.deepEqual(detailRoleFields(null), { role: "member", protected: false });
  assert.deepEqual(detailRoleFields({ role: "master_admin", enabled: false }), {
    role: "member",
    protected: true,
  });
});

test("GET /api/admin?account= calls admin_account_detail and returns roles", async () => {
  const calls = [];
  const payloads = {
    [MASTER]: {
      id: MASTER,
      name: "Owner",
      email: "owner@example.com",
      ...detailRoleFields({ role: "master_admin", enabled: true }),
    },
    [MEMBER]: {
      id: MEMBER,
      name: "Member",
      email: "member@example.com",
      ...detailRoleFields(null),
    },
    [DISABLED]: {
      id: DISABLED,
      name: "Former admin",
      email: "former@example.com",
      ...detailRoleFields({ role: "master_admin", enabled: false }),
    },
  };
  class ApiError extends Error {
    constructor(message, status = 400) {
      super(message);
      this.status = status;
    }
  }
  const { GET } = load("src/app/api/admin/route.ts", {
    "@/lib/admin": { adminSession: async () => ({ token: MASTER }) },
    "@/lib/mail": { mailReady: async () => true },
    "@/lib/server": {
      ApiError,
      failure: (e) =>
        Response.json(
          { error: e instanceof Error ? e.message : "error" },
          { status: e?.status || 500 },
        ),
      integer: (value, label, min, max) => {
        const n = Number(value);
        if (!Number.isInteger(n) || n < min || n > max) throw new ApiError(`Invalid ${label}.`);
        return n;
      },
      string: (value, label = "value", max = 100, min = 0) => {
        const text = String(value ?? "");
        if (text.length < min || text.length > max) throw new ApiError(`Invalid ${label}.`);
        return text;
      },
      uuid: (value) => {
        const id = String(value ?? "");
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
          throw new ApiError("Invalid id.");
        return id;
      },
      sameOrigin() {},
      body: async () => ({}),
      backend: async (rpcPath, opts) => {
        calls.push(rpcPath);
        assert.equal(rpcPath, "/rest/v1/rpc/admin_account_detail");
        const id = opts.body ? JSON.parse(opts.body).account_id : null;
        return payloads[id];
      },
    },
  });

  async function detail(id) {
    const req = new Request(`https://zenvio.test/api/admin?account=${id}`);
    Object.defineProperty(req, "nextUrl", { value: new URL(req.url) });
    const res = await GET(req);
    assert.equal(res.status, 200);
    return res.json();
  }

  const master = await detail(MASTER);
  assert.equal(master.role, "master_admin");
  assert.equal(master.protected, true);

  const member = await detail(MEMBER);
  assert.equal(member.role, "member");
  assert.equal(member.protected, false);

  const disabled = await detail(DISABLED);
  assert.equal(disabled.role, "member");
  assert.equal(disabled.protected, true);

  assert.equal(calls.length, 3);
  assert.ok(calls.every((p) => p === "/rest/v1/rpc/admin_account_detail"));
});

test("admin account modal uses overview, booking, activity, and admin sections", () => {
  const ui = fs.readFileSync("src/components/admin-center.tsx", "utf8");
  assert.match(ui, /Account overview/);
  assert.match(ui, /Booking configuration/);
  assert.match(ui, /Activity/);
  assert.match(ui, /Account administration/);
  assert.match(ui, /detail\.protected/);
  assert.match(ui, /detail\.created_at/);
  assert.match(ui, /gozenvio\.com\/book\/\$\{detail\.slug\}/);
});

test("admin user actions hide controls using protect flag, not only enabled role", () => {
  const actions = fs.readFileSync("src/components/admin-user-actions.tsx", "utf8");
  assert.match(actions, /account\.protected \|\| account\.role === "master_admin"/);
  assert.match(actions, /aad-admin-buttons/);
  assert.match(actions, /notice error/);
});

test("services UI prefers Services terminology over Add a booking link", () => {
  const workspace = fs.readFileSync("src/components/workspace.tsx", "utf8");
  assert.match(workspace, /Add a service/);
  assert.match(workspace, /Service activated/);
  assert.doesNotMatch(workspace, /Add a booking link/);
});
