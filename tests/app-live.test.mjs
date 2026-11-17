import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (f) => fs.readFileSync(f, "utf8");

test("workspace live stream is session-scoped and uses the cheap change fingerprint", () => {
  const route = read("src/app/api/app/stream/route.ts");
  const lib = read("src/lib/app-live.ts");
  assert.match(route, /session\(\)/);
  assert.match(route, /workspaceSignature\(token\)/);
  assert.match(route, /changeStream/);
  assert.match(lib, /threadAccess/);
  assert.match(lib, /threadUnreadCountSql/);
  assert.match(lib, /thread_user_state/);
  assert.match(lib, /FROM public\.bookings WHERE user_id=\$1/);
  assert.match(lib, /private\.message_threads/);
  assert.match(lib, /t\.id::text\|\|t\.status\|\|coalesce\(t\.assigned_to::text/);
  assert.match(lib, /md5\(string_agg\(id::text\|\|status/);
  assert.doesNotMatch(lib, /m\.read_at IS NULL/);
  assert.doesNotMatch(lib, /SELECT \*/);
});

test("portal live stream peeks the token without bumping last_used_at", () => {
  const route = read("src/app/api/portal/[token]/stream/route.ts");
  const portal = read("src/lib/portal.ts");
  assert.match(route, /peekPortal/);
  assert.match(route, /portalSignature/);
  assert.doesNotMatch(route, /resolvePortal/);
  assert.match(portal, /export async function peekPortal/);
  assert.doesNotMatch(portal.slice(portal.indexOf("export async function peekPortal"), portal.indexOf("export async function resolvePortal")), /last_used_at/);
  assert.match(portal, /b\.user_id=\$1 AND \(b\.contact_id=\$2 OR lower\(b\.guest_email\)=lower\(\$3\)\)/);
  assert.match(portal, /t\.user_id=\$1 AND t\.contact_id=\$2/);
  assert.match(portal, /count\(DISTINCT e\.id\)/);
  assert.match(portal, /max\(r\.created_at\)/);
  assert.match(portal, /private\.appointment_payments p JOIN public\.bookings b/);
});

test("open envelope refreshes on live change without wiping draft fields", () => {
  const source = read("src/components/envelopes.tsx");
  assert.match(source, /keepDraftFields = detail\.envelope\.status === "draft"/);
  assert.match(source, /if \(!keepDraftFields\) setFields/);
  assert.match(source, /freshLiveDetail\(\);\s*const still = freshDetail\(\)/);
});

test("live refreshes ignore superseded responses and keep loaded pages on failure", () => {
  const support = read("src/components/platform-support.tsx");
  const workspace = read("src/components/workspace.tsx");
  const jobs = read("src/components/jobs-center.tsx");
  assert.match(support, /export function useFreshRequest/);
  assert.match(workspace, /if \(dataRef\.current\)/);
  assert.match(workspace, /dataStamp\.current >= remoteStamp\.current/);
  assert.match(jobs, /if \(hasDetail\.current\) notify/);
});

test("workspace shell and portal subscribe to live updates", () => {
  const shell = read("src/components/app-shell.tsx");
  const portal = read("src/components/client-portal.tsx");
  const inbox = read("src/components/inbox-center.tsx");
  assert.match(shell, /\/api\/app\/stream/);
  assert.match(shell, /WORKSPACE_LIVE_EVENT/);
  assert.match(portal, /\/api\/portal\/\$\{token\}\/stream/);
  assert.match(inbox, /useWorkspaceLive/);
  assert.doesNotMatch(inbox, /setInterval/);
});

test("service worker leaves event streams on the network", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /text\/event-stream/);
  assert.match(sw, /zenvio-static-v3/);
});
