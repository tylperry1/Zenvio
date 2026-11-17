import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (f) => fs.readFileSync(f, "utf8");

test("support ops migration expands statuses and adds SLA/KB/events", () => {
  const migration = read("postgres/migrations/095_support_ops_center.sql");
  assert.match(migration, /waiting_customer/);
  assert.match(migration, /support_ticket_events/);
  assert.match(migration, /support_sla_policies/);
  assert.match(migration, /support_kb_articles/);
  assert.match(migration, /revoke all on private\.support_ticket_events/);
  assert.doesNotMatch(migration, /drop table private\.support_tickets/i);
});

test("platform alerts + web push migration is additive", () => {
  const migration = read("postgres/migrations/096_platform_alerts_web_push.sql");
  assert.match(migration, /platform_alerts/);
  assert.match(migration, /push_subscriptions/);
  assert.match(migration, /web_push/);
  assert.match(migration, /revoke all on private\.platform_alerts/);
});

test("SLA helper never claims compliance without dues/timestamps", () => {
  const sla = read("src/lib/support-sla.ts");
  assert.match(sla, /Never claim SLA met\/breached when the required timestamps or policy targets are missing/);
  assert.match(sla, /state: "unknown"/);
  assert.match(sla, /First response SLA not configured/);
  assert.match(sla, /addBusinessMinutes/);
  assert.match(sla, /business_hours_only/);
  assert.doesNotMatch(sla, /ORDER BY updated_at DESC LIMIT/);
});

test("Greptile P1 guards: ticket-before-dashboard, merge safety, empty caps, push after commit", () => {
  const ops = read("src/lib/support-ops.ts");
  const lib = read("src/lib/support.ts");
  const notify = read("src/lib/support-notify.ts");
  const bell = read("src/components/admin-alert-bell.tsx");
  assert.match(ops, /Ticket detail must win over the dashboard default/);
  assert.match(ops, /same signed-in customer/);
  assert.match(ops, /already merged/);
  assert.match(ops, /No agent row: defaults\. Empty stored array/);
  assert.match(lib, /status NOT IN \('resolved','closed'\) AND merged_into IS NULL/);
  assert.match(lib, /resolveMergeTarget/);
  assert.match(lib, /requireCap\(caps,/);
  assert.match(notify, /push: false/);
  assert.match(bell, /Permission alone is not registration/);
});

test("CodeRabbit majors: attachment inbox gate, merge lock, stale queue, closed SLA refresh", () => {
  const lib = read("src/lib/support.ts");
  const visitor = read("src/lib/support-visitor.ts");
  const ops = read("src/lib/support-ops.ts");
  const sla = read("src/lib/support-sla.ts");
  const ui = read("src/components/support-ops-center.tsx");
  assert.match(lib, /Downloads use the same capability gate as the inbox/);
  assert.match(lib, /if \(staff\) requireCap\(caps, "inbox"\)/);
  assert.match(lib, /if \(staff && result\.rows\[0\]\.internal\) requireCap\(caps, "notes"\)/);
  assert.match(visitor, /Source-ticket tokens must not open the survivor/);
  assert.match(visitor, /if \(row\.merged_into\) return null/);
  assert.match(visitor, /Re-check merge state under the row lock/);
  assert.match(visitor, /This conversation was merged\. Refresh the page and try again/);
  assert.match(ops, /Visitor emails are self-asserted and unverified/);
  assert.doesNotMatch(ops, /sameVisitor/);
  assert.match(sla, /Include completed tickets so a pre-deadline false flag/);
  assert.match(sla, /OR closed_at IS NOT NULL/);
  assert.match(sla, /status IN \('resolved','closed'\) AND closed_at IS NOT NULL THEN closed_at/);
  assert.match(ui, /queueReq/);
  assert.match(ui, /Drop superseded responses when filters change mid-flight/);
});

test("CodeRabbit follow-ups: feedback after awaits push; SW register propagates", () => {
  const feedback = read("src/app/api/feedback/route.ts");
  const bell = read("src/components/admin-alert-bell.tsx");
  const platform = read("src/components/platform-support.tsx");
  assert.match(feedback, /after\(async \(\) =>/);
  assert.match(feedback, /await Promise\.all/);
  assert.match(bell, /await navigator\.serviceWorker\.register\("\/sw\.js"/);
  assert.doesNotMatch(bell, /register\("\/sw\.js".*\.catch\(\(\) => null\)/);
  assert.match(bell, /Promise\.race/);
  assert.match(platform, /t\.status === "resolved" \|\| t\.status === "closed"/);
});

test("CodeRabbit majors: masking, customer status lock, push allowlist, SW ready", () => {
  const ops = read("src/lib/support-ops.ts");
  const lib = read("src/lib/support.ts");
  const push = read("src/lib/web-push.ts");
  const bell = read("src/components/admin-alert-bell.tsx");
  const feedback = read("src/app/api/feedback/route.ts");
  assert.match(ops, /visitor_token_sealed/);
  assert.match(ops, /delete next\.visitor_token_sealed/);
  assert.match(ops, /applySlaDeadlines\(db, id, priority, new Date\(updated\.rows\[0\]\.created_at\)\)/);
  assert.match(lib, /You can only resolve or reopen your own conversation/);
  assert.match(lib, /WHEN status IN \('escalated','in_progress','waiting_internal'\) THEN status/);
  assert.match(lib, /SAVEPOINT support_best_effort/);
  assert.match(push, /assertPushServiceEndpoint/);
  assert.match(push, /import \* as webpush/);
  assert.match(push, /timeout: 10_000/);
  assert.match(bell, /serviceWorker\.ready/);
  assert.match(feedback, /push: false/);
  assert.match(feedback, /after\(/);
});

test("support ops denies impersonation secrets and gates capabilities", () => {
  const ops = read("src/lib/support-ops.ts");
  assert.match(ops, /requireCap\(caps, "escalate"\)/);
  assert.match(ops, /requireCap\(caps, "merge"\)/);
  assert.match(ops, /impersonate/);
  assert.match(ops, /Payment credentials|has_billing_customer|subscription_view/);
  assert.doesNotMatch(ops, /stripe_secret|api_key|password/i);
});

test("admin nav includes Support Operations and Suggestions badges wiring", () => {
  const nav = read("src/lib/admin-console-nav.ts");
  const ui = read("src/components/admin-navigation.tsx");
  assert.match(nav, /id: "support-ops"/);
  assert.match(nav, /href: "\/admin\/support-ops"/);
  assert.match(ui, /AdminAlertBell/);
  assert.match(ui, /item\.id === "feedback"\) && feedbackOpen/);
  assert.match(ui, /item\.id === "support" \|\| item\.id === "support-ops"/);
  assert.match(ui, /supportWaiting/);
});

test("web push adapter records web_push provider and does not claim empty delivery", () => {
  const adapters = read("src/lib/notifications/adapters.ts");
  assert.match(adapters, /provider: "web_push"/);
  assert.match(adapters, /No registered push devices|Push skipped/);
  assert.doesNotMatch(adapters, /not activated in this slice/);
});

test("service worker handles push and notificationclick", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /addEventListener\("push"/);
  assert.match(sw, /addEventListener\("notificationclick"/);
  assert.match(sw, /showNotification/);
});

test("status aliases keep pending compatible with waiting_customer", () => {
  const options = read("src/lib/support-options.ts");
  const lib = read("src/lib/support.ts");
  assert.match(options, /if \(v === "pending"\) return "waiting_customer"/);
  assert.match(lib, /normalizeSupportStatus/);
  assert.match(lib, /status='waiting_customer'/);
});
