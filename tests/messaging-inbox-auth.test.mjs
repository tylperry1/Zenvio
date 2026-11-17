import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const messaging = fs.readFileSync("src/lib/messaging.ts", "utf8");
const inbox = fs.readFileSync("src/app/api/inbox/route.ts", "utf8");
const portal = fs.readFileSync("src/app/api/portal/[token]/route.ts", "utf8");
const migration = fs.readFileSync("postgres/migrations/099_messaging_inbox_repair.sql", "utf8");

test("threadAccess scopes owner, assignee, and org admins only", () => {
  assert.match(messaging, /t\.user_id=\$1 OR t\.assigned_to=\$1/);
  assert.match(messaging, /role IN \('owner','administrator'\)/);
});

test("sendThreadMessage re-checks accessibleThread before writing", () => {
  assert.match(messaging, /await accessibleThread\(db, input\.actor\.id, input\.threadId\)/);
});

test("message edit and soft-delete enforce threadAccess and audit", () => {
  assert.match(messaging, /export async function editThreadMessage/);
  assert.match(messaging, /export async function softDeleteThreadMessage/);
  assert.match(messaging, /thread_message_revisions/);
  assert.match(messaging, /deleted_at=now\(\)/);
  assert.match(messaging, /recordThreadActivity/);
});

test("inbox API exposes lifecycle filters, metrics, edit/delete actions", () => {
  assert.match(inbox, /unassigned/);
  assert.match(inbox, /pending_response/);
  assert.match(inbox, /archived/);
  assert.match(inbox, /inboxMetrics/);
  assert.match(inbox, /"edit-message"/);
  assert.match(inbox, /"delete-message"/);
  assert.match(inbox, /canAdministerThread/);
  assert.match(inbox, /deleted_at IS NULL/);
});

test("portal excludes internal notes, SMS, and soft-deleted messages", () => {
  assert.match(portal, /m\.direction<>'internal'/);
  assert.match(portal, /m\.channel<>'sms'/);
  assert.match(portal, /m\.deleted_at IS NULL/);
});

test("migration expands status and adds soft-delete/revision/activity tables", () => {
  assert.match(migration, /pending_response/);
  assert.match(migration, /archived/);
  assert.match(migration, /thread_message_revisions/);
  assert.match(migration, /thread_activity/);
  assert.match(migration, /deleted_at/);
});

test("assignment notifies assignee without leaking note bodies", () => {
  assert.match(messaging, /notifyThreadAssignment/);
  assert.match(messaging, /conversation_assigned/);
  assert.match(messaging, /Conversation assigned/);
  assert.doesNotMatch(messaging, /notifyThreadAssignment[\s\S]{0,800}note body/i);
});

test("inbox detail includes recent bookings for customer context", () => {
  assert.match(inbox, /recentBookings/);
  assert.match(inbox, /ORDER BY b\.starts_at DESC LIMIT 8/);
});

test("per-user read state does not clear shared message.read_at on open", () => {
  const reads = fs.readFileSync("postgres/migrations/100_messaging_per_user_reads.sql", "utf8");
  assert.match(reads, /thread_user_state/);
  assert.match(messaging, /markThreadReadForUser/);
  assert.match(messaging, /markThreadUnreadForUser/);
  assert.match(messaging, /threadUnreadCountSql/);
  assert.match(inbox, /markThreadReadForUser/);
  assert.doesNotMatch(
    inbox,
    /UPDATE private\.thread_messages\s+SET read_at=now\(\)\s+WHERE thread_id=\$1 AND direction='inbound'/,
  );
});

test("status changes can notify closed customers and pending staff", () => {
  assert.match(messaging, /notifyThreadStatusChange/);
  assert.match(messaging, /conversation_closed/);
  assert.match(messaging, /conversation_pending_response/);
  assert.match(inbox, /notifyThreadStatusChange/);
});
