import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";
let blocked = false,
  unavailable = false,
  reservations = 0;
class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const filename = path.resolve("src/app/api/book/route.ts"),
  m = new Module(filename);
m.filename = filename;
m.paths = Module._nodeModulePaths(path.dirname(filename));
const original = m.require.bind(m);
m.require = (id) =>
  id === "@/lib/appointment-payments"
    ? {}
    : id === "@/lib/workflows"
      ? {}
      : id === "@/lib/lifecycle"
        ? {}
        : id === "@/lib/intake"
          ? { intakeAnswers: () => [] }
          : id === "@/lib/db"
            ? {
                getPool: () => ({
                  query: async () => ({
                    rows: [{ intake_questions: [], payment_mode: "free" }],
                  }),
                }),
              }
            : id === "next/server"
              ? { after: () => {} }
              : id === "@/lib/mail"
                ? { deliverBookingEmails: async () => {} }
                : id === "@/lib/google-calendar"
                  ? {
                      filterGoogleSlots: async (h, e, slots) => {
                        if (unavailable)
                          throw new ApiError("Calendar unavailable", 503);
                        return blocked ? [] : slots;
                      },
                      runGoogleJobsForHost: async () => {},
                    }
                  : id === "@/lib/server"
                    ? {
                        ApiError,
                        slug: (v) => v,
                        string: (v) => v,
                        email: (v) => v,
                        body: (r) => r.json(),
                        sameOrigin: () => {},
                        failure: (e) =>
                          Response.json(
                            { error: e.message },
                            { status: e.status || 500 },
                          ),
                        backend: async (p) => {
                          if (p.includes("reserve_booking")) {
                            reservations++;
                            return { id: "booking" };
                          }
                          if (p.endsWith("public_event"))
                            return [{ duration: 30 }];
                          if (p.endsWith("public_slots"))
                            return [{ starts_at: "2026-11-02T15:00:00Z" }];
                          throw Error("Unexpected call");
                        },
                      }
                    : original(id);
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
const { GET, POST } = m.exports;
const request = () =>
  new Request("https://zenvio.test/api/book", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      host: "host",
      event: "intro",
      starts_at: "2026-11-02T15:00:00Z",
      name: "Guest",
      email: "guest@example.com",
    }),
  });
beforeEach(() => {
  blocked = false;
  unavailable = false;
  reservations = 0;
});
test("Google conflicts reject confirmation before creating a booking", async () => {
  blocked = true;
  assert.equal((await POST(request())).status, 409);
  assert.equal(reservations, 0);
});
test("Google outages do not silently create bookings without checking availability", async () => {
  unavailable = true;
  assert.equal((await POST(request())).status, 503);
  assert.equal(reservations, 0);
});
test("available Google time proceeds to the existing transactional reservation", async () => {
  assert.equal((await POST(request())).status, 201);
  assert.equal(reservations, 1);
});
test("public slot responses exclude Google conflicts", async () => {
  blocked = true;
  const r = new Request(
    "https://zenvio.test/api/book?host=host&event=intro&date=2026-11-02",
  );
  Object.defineProperty(r, "nextUrl", { value: new URL(r.url) });
  const response = await GET(r);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).slots, []);
});
