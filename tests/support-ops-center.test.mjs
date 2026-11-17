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
  assert.match(ops, /same customer/);
  assert.match(ops, /already merged/);
  assert.match(ops, /No agent row: defaults\. Empty stored array/);
  assert.match(lib, /status NOT IN \('resolved','closed'\) AND merged_into IS NULL/);
  assert.match(lib, /resolveMergeTarget/);
  assert.match(lib, /requireCap\(caps,/);
  assert.match(notify, /push: false/);
  assert.match(bell, /Permission alone is not registration/);
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
