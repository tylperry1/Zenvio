import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";

// Exercise the real admin routes with only the authentication library and SQL transport substituted.
let token = null,
  role = "member",
  requests = [];
const jar = {
  get: (name) =>
    name === "zenvio_access" && token ? { value: token } : undefined,
  set() {},
  delete() {},
};
const cache = new Map();
function load(relative) {
  const filename = path.resolve(relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = new Module(filename);
  cache.set(filename, mod);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const standard = mod.require.bind(mod);
  mod.require = (id) =>
    id === "next/headers"
      ? { headers: async () => new Headers() }
      : id === "./auth"
        ? { getAuth: () => ({api:{getSession:async()=> token ? {user:{id:token,email:"owner@example.com",role:"master_admin"}} : null}}) }
      : id === "./db"
        ? {databaseConfigured:()=>true}
      : id === "./postgres-backend"
        ? {postgresBackend:async(path,options)=>{
            requests.push({path,options});
            if(path.endsWith("current_platform_role"))return role;
            if(path.endsWith("admin_overview"))return {accounts:[],total:0};
            if(path.endsWith("admin_event_status"))return null;
            throw new Error("Unexpected SQL operation");
          }}
      : id === "@/lib/admin"
        ? load("src/lib/admin.ts")
        : id === "@/lib/server" || id === "./server"
          ? load("src/lib/server.ts")
          : standard(id);
  mod._compile(compiled, filename);
  return mod.exports;
}
const route = load("src/app/api/admin/route.ts");
beforeEach(() => {
  token = null;
  role = "member";
  requests = [];
 });
function request(method = "GET", data, origin = "https://zenvio.example") {
  const r = new Request("https://zenvio.example/api/admin", {
    method,
    headers: {
      ...(origin ? { Origin: origin } : {}),
      "Content-Type": "application/json",
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  Object.defineProperty(r, "nextUrl", { value: new URL(r.url) });
  return r;
}
test("anonymous visitors receive 401 before any account query", async () => {
  const r = await route.GET(request());
  assert.equal(r.status, 401);
  assert.equal(requests.length, 0);
});
test("member metadata cannot forge the database master-admin role", async () => {
  token = "valid-member";
  const r = await route.GET(request());
  assert.equal(r.status, 403);
  assert.deepEqual(
    requests.map((r) => r.path),
    ["/rest/v1/rpc/current_platform_role"],
  );
});
test("a verified session and current database role allow admin reads", async () => {
  token = "valid-admin";
  role = "master_admin";
  const r = await route.GET(request());
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual((await r.json()).accounts, []);
  assert.equal(requests.at(-1).path, "/rest/v1/rpc/admin_overview");
});
test("revoking the role takes effect on the next admin request", async () => {
  token = "valid-admin";
  role = "master_admin";
  assert.equal((await route.GET(request())).status, 200);
  role = "member";
  assert.equal((await route.GET(request())).status, 403);
  assert.equal(
    requests.filter((r) => r.path.endsWith("/admin_overview")).length,
    1,
  );
});
test("cross-origin admin changes are denied before authentication", async () => {
  token = "valid-admin";
  role = "master_admin";
  const r = await route.POST(
    request("POST", { action: "event-status" }, "https://untrusted.example"),
  );
  assert.equal(r.status, 403);
  assert.equal(requests.length, 0);
});
test("admin changes require a reason and a valid event ID", async () => {
  token = "valid-admin";
  role = "master_admin";
  const r = await route.POST(
    request("POST", {
      action: "event-status",
      eventId: "11111111-1111-4111-8111-111111111111",
      active: false,
      reason: "no",
    }),
  );
  assert.equal(r.status, 400);
  assert(!requests.some((r) => r.path.endsWith("/admin_event_status")));
});
test("authorized changes forward only validated audit parameters", async () => {
  token = "valid-admin";
  role = "master_admin";
  const r = await route.POST(
    request("POST", {
      action: "event-status",
      eventId: "11111111-1111-4111-8111-111111111111",
      active: false,
      reason: "Owner requested a temporary pause.",
      role: "master_admin",
      user_id: "untrusted",
    }),
  );
  assert.equal(r.status, 200);
  const data = JSON.parse(requests.at(-1).options.body);
  assert.deepEqual(data, {
    target_event: "11111111-1111-4111-8111-111111111111",
    enabled: false,
    reason: "Owner requested a temporary pause.",
  });
});
