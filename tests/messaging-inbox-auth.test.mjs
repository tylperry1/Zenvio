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

test("personal inbox is the default and workspace filters require admin capability", () => {
  assert.match(inbox, /params\.get\("filter"\) \|\| "mine"/);
  assert.match(inbox, /canAccessWorkspaceInbox/);
  assert.match(inbox, /Workspace inbox requires owner or administrator access/);
  assert.match(inbox, /personalOnly/);
  assert.match(messaging, /export async function canAccessWorkspaceInbox/);
  assert.match(messaging, /scope === "personal"/);
  assert.match(messaging, /anyMembership/);
  assert.match(messaging, /assigned_to=\$1 OR \(t\.user_id=\$1 AND t\.assigned_to IS NULL\)/);
  assert.match(messaging, /assigned_to\)\s*\n\s*VALUES\(/);
  assert.doesNotMatch(
    messaging,
    /ON CONFLICT \(user_id,contact_id\)[\s\S]{0,280}assigned_to=COALESCE/,
  );
  const ui = fs.readFileSync("src/components/inbox-center.tsx", "utf8");
  assert.match(ui, /useState<Filter>\("mine"\)/);
  assert.match(ui, /label: "My Inbox"/);
  assert.match(ui, /label: "Workspace"/);
  assert.match(ui, /workspaceInbox === true/);
  assert.match(ui, /if \(activeListKey\.current !== identity\) return;\s*\n\s*const still = freshList\(\)/);
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
  assert.match(messaging, /readThroughAt/);
  assert.match(messaging, /last_read_at < EXCLUDED\.last_read_at/);
  assert.match(inbox, /markThreadReadForUser/);
  assert.match(inbox, /if \(advanced\)/);
  assert.doesNotMatch(
    inbox,
    /UPDATE private\.thread_messages\s+SET read_at=now\(\)\s+WHERE thread_id=\$1 AND direction='inbound'/,
  );
});

test("SMS send uses the same phone fallback as readiness", () => {
  assert.match(messaging, /contactPhone\(db, t\.user_id, t\.contact_id\)\) \|\| t\.contact_phone \|\| ""/);
});

test("assign/status lock thread inside the mutation transaction", () => {
  assert.match(inbox, /SELECT assigned_to FROM private\.message_threads WHERE id=\$1 FOR UPDATE/);
  assert.match(inbox, /SELECT status, assigned_to FROM private\.message_threads WHERE id=\$1 FOR UPDATE/);
});

test("unread list total is counted after the unread filter", () => {
  assert.match(inbox, /count\(\*\) OVER\(\)::int total FROM \(\s*SELECT t\.id/);
  assert.match(inbox, /\) y \$\{filter === "unread" \? "WHERE unread>0" : ""\}/);
});

test("status changes can notify closed customers and pending staff", () => {
  assert.match(messaging, /notifyThreadStatusChange/);
  assert.match(messaging, /conversation_closed/);
  assert.match(messaging, /conversation_pending_response/);
  assert.match(inbox, /notifyThreadStatusChange/);
});

test("edit/delete require admin when author_id is null or another user", () => {
  assert.match(messaging, /msg\.author_id !== input\.userId/);
  assert.doesNotMatch(messaging, /if \(msg\.author_id && msg\.author_id !== input\.userId\)/);
});

test("start with booking reuses existing booking thread", () => {
  assert.match(inbox, /WHERE user_id=\$1 AND booking_id=\$2/);
  assert.match(inbox, /ON CONFLICT \(booking_id\) WHERE booking_id IS NOT NULL/);
  assert.doesNotMatch(
    inbox,
    /UPDATE private\.message_threads SET booking_id=\$2\s+WHERE id=\$1 AND user_id=\$3 AND booking_id IS NULL/,
  );
});

test("list page size restored and assistant uses per-user unread", () => {
  assert.match(inbox, /pageSize = 100/);
  const tools = fs.readFileSync("src/lib/assistant/tools.ts", "utf8");
  assert.match(tools, /threadUnreadCountSql/);
  assert.match(tools, /m\.deleted_at IS NULL/);
  assert.doesNotMatch(tools, /m\.read_at IS NULL/);
});

test("SMS bridge does not reopen archived contact threads", () => {
  assert.match(messaging, /reopen:\s*false/);
  assert.match(messaging, /CASE WHEN \$4::boolean THEN 'open' ELSE private\.message_threads\.status END/);
});

test("notification keys are scoped per distinct transition", () => {
  assert.match(messaging, /notify:thread-assign:\$\{transitionId\}/);
  assert.match(messaging, /thread-closed:\$\{transitionId\}/);
  assert.match(messaging, /thread-pending:\$\{transitionId\}/);
  assert.doesNotMatch(messaging, /notify:thread-assign:\$\{input\.threadId\}:\$\{input\.assigneeId\}:\$\{day\}/);
});

test("load more tracks filter/search identity", () => {
  const ui = fs.readFileSync("src/components/inbox-center.tsx", "utf8");
  assert.match(ui, /listKey/);
  assert.match(ui, /prev\.listKey !== identity/);
  assert.match(ui, /list\.listKey === listKey/);
});

test("staff role is not in threadAccess; only owner/admin/assignee/host", () => {
  assert.match(messaging, /role IN \('owner','administrator'\)/);
  assert.doesNotMatch(messaging, /role IN \('owner','administrator','staff'\)/);
  assert.match(messaging, /t\.assigned_to=\$1/);
});

test("attachments download and upload require accessibleThread", () => {
  const attachments = fs.readFileSync("src/app/api/inbox/attachments/route.ts", "utf8");
  assert.match(attachments, /accessibleThread/);
  assert.match(attachments, /await accessibleThread\(getPool\(\), user\.id, file\.thread_id\)/);
  assert.match(attachments, /await accessibleThread\(getPool\(\), user\.id, uuid\(/);
});

test("dual-store: provider SMS bridges into product inbox via helper", () => {
  assert.match(messaging, /bridgeProviderSmsToInbox/);
  assert.match(messaging, /messaging_threads/);
  const telnyx = fs.readFileSync("src/app/api/messaging/telnyx/route.ts", "utf8");
  assert.match(telnyx, /bridgeProviderSmsToInbox/);
  assert.doesNotMatch(telnyx, /ensureContactThread/);
  const messagesApi = fs.readFileSync("src/app/api/messages/route.ts", "utf8");
  // Ledger route queries messaging_threads only (comment may mention message_threads).
  assert.match(messagesApi, /from private\.messaging_threads/);
  assert.doesNotMatch(messagesApi, /from private\.message_threads/);
  assert.doesNotMatch(messagesApi, /into private\.message_threads/);
});

test("mark unread leaves conversation instead of reloading thread", () => {
  const ui = fs.readFileSync("src/components/inbox-center.tsx", "utf8");
  assert.match(ui, /onMarkedUnread/);
  assert.match(ui, /await onMarkedUnread\(\)/);
  assert.doesNotMatch(
    ui,
    /action: "unread"[\s\S]{0,120}await onChange\(\)/,
  );
});

test("live fingerprint uses per-user unread and edit/delete tokens", () => {
  const live = fs.readFileSync("src/lib/app-live.ts", "utf8");
  assert.match(live, /threadUnreadCountSql/);
  assert.match(live, /thread_user_state/);
  assert.match(live, /max\(m\.edited_at\)/);
  assert.match(live, /max\(m\.deleted_at\)/);
  assert.doesNotMatch(live, /m\.read_at IS NULL/);
});
