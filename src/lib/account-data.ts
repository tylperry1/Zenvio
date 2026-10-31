import { verifyPassword } from "better-auth/crypto";
import { getPool } from "./db";
import { ApiError } from "./server";

type Query = { sql: string; key: string };
// Everything a person's account holds that they can take with them.
const exportQueries: Query[] = [
  {key:"shared_messages",sql:"SELECT id,thread_id,channel,direction,state,body,provider,provider_message_id,sent_at,delivered_at,received_at,created_at FROM private.message_records WHERE user_id=$1 ORDER BY created_at"},
  {key:"communication_consents",sql:"SELECT phone_e164,scope,status,source,country_code,recorded_at,revoked_at FROM private.contact_consents WHERE user_id=$1"},
  {key:"customer_balances",sql:"SELECT id,contact_id,kind,unit,balance,expires_at,created_at FROM private.customer_balance_accounts WHERE user_id=$1"},
  {key:"customer_balance_ledger",sql:"SELECT id,account_id,delta,balance_after,reference,reason,reversal_of,created_at FROM private.customer_balance_entries WHERE user_id=$1 ORDER BY created_at"},
  {key:"private_file_metadata",sql:"SELECT id,filename,content_type,byte_size,sha256,scan_status,state,created_at FROM private.stored_files WHERE user_id=$1"},
  {key:"video_meetings",sql:"SELECT booking_id,provider,starts_at,expires_at,created_at FROM private.video_rooms WHERE user_id=$1"},
  { key: "profile", sql: "SELECT id,name,slug,timezone,bio,headline,company,accent_color,website,location,social_links,booking_instructions,industry,created_at FROM public.profiles WHERE id=$1" },
  { key: "account", sql: 'SELECT email,name,"emailVerified","createdAt" FROM public."user" WHERE id=$1' },
  { key: "appointment_types", sql: "SELECT * FROM public.event_types WHERE user_id=$1 ORDER BY created_at" },
  { key: "availability", sql: "SELECT day,enabled,start_time,end_time FROM public.availability WHERE user_id=$1 ORDER BY day" },
  { key: "appointments", sql: "SELECT id,event_id,guest_name,guest_email,guest_phone,guest_company,meeting_purpose,notes,intake_snapshot,starts_at,ends_at,status,created_at FROM public.bookings WHERE user_id=$1 ORDER BY starts_at" },
  { key: "clients", sql: "SELECT id,name,email,company,notes,created_at FROM public.contacts WHERE user_id=$1 ORDER BY created_at" },
  { key: "client_tasks", sql: "SELECT * FROM private.client_tasks WHERE user_id=$1" },
  { key: "text_agreements", sql: "SELECT id,title,status,recipient_name,recipient_email,created_at,signed_at FROM private.signing_documents WHERE user_id=$1" },
  { key: "pdf_documents", sql: "SELECT id,title,status,created_at,completed_at FROM private.signature_envelopes WHERE user_id=$1" },
  { key: "workflows", sql: "SELECT * FROM private.workflow_rules WHERE user_id=$1" },
  { key: "subscription", sql: "SELECT plan,status,current_period_end,cancel_at_period_end FROM private.subscriptions WHERE user_id=$1" },
  { key: "appointment_payments", sql: "SELECT id,booking_id,status,amount_cents,total_cents,refunded_cents,currency,created_at FROM private.appointment_payments WHERE user_id=$1" },
  { key: "marketplace_orders", sql: "SELECT id,status,payment_status,total_cents,created_at FROM private.marketplace_orders WHERE user_id=$1" },
  { key: "messages", sql: "SELECT t.contact_id,m.direction,m.channel,m.author_name,m.body,m.status,m.created_at FROM private.message_threads t JOIN private.thread_messages m ON m.thread_id=t.id WHERE t.user_id=$1 ORDER BY m.created_at" },
  { key: "message_templates", sql: "SELECT name,body,created_at FROM private.message_templates WHERE user_id=$1" },
  { key: "jobs", sql: "SELECT id,contact_id,booking_id,title,category,address,description,preferred_time,status,source,created_at,completed_at FROM private.jobs WHERE user_id=$1 ORDER BY created_at" },
  { key: "estimates", sql: "SELECT id,job_id,number,title,line_items,subtotal_cents,tax_cents,total_cents,deposit_cents,notes,authorization_terms,status,approved_name,sent_at,decided_at FROM private.estimates WHERE user_id=$1 ORDER BY number" },
  { key: "payment_requests", sql: "SELECT id,job_id,kind,description,amount_cents,currency,status,paid_at,created_at FROM private.payment_requests WHERE user_id=$1" },
  { key: "assistant_conversations", sql: "SELECT c.title,m.role,m.content,m.created_at FROM private.ai_conversations c JOIN private.ai_messages m ON m.conversation_id=c.id WHERE c.user_id=$1 ORDER BY m.created_at" },
  { key: "assistant_actions", sql: "SELECT tool,preview,status,result,error,created_at,decided_at,completed_at FROM private.ai_actions WHERE user_id=$1 ORDER BY created_at" },
  { key: "feedback", sql: "SELECT category,message,page,status,admin_note,created_at FROM private.feedback WHERE user_id=$1" },
];

export async function exportAccount(userId: string) {
  const out: Record<string, unknown> = { exported_at: new Date().toISOString() };
  for (const { key, sql } of exportQueries) {
    const { rows } = await getPool().query(sql, [userId]);
    out[key] = ["profile", "account", "subscription"].includes(key) ? rows[0] ?? null : rows;
  }
  return out;
}

// Records that must be kept or settled before an account can be removed.
export async function deletionBlockers(userId: string) {
  const { rows } = await getPool().query(
    `SELECT
      EXISTS(SELECT 1 FROM private.platform_roles WHERE user_id=$1) AS admin,
      EXISTS(SELECT 1 FROM private.subscriptions WHERE user_id=$1 AND subscription_id IS NOT NULL
             AND status IN ('active','trialing','past_due','unpaid','incomplete')) AS subscription,
      EXISTS(SELECT 1 FROM private.organizations WHERE owner_id=$1) AS team,
      (EXISTS(SELECT 1 FROM private.google_calendar_connections WHERE user_id=$1) OR EXISTS(SELECT 1 FROM private.microsoft_calendar_connections WHERE user_id=$1)) AS google,
      (EXISTS(SELECT 1 FROM private.customer_balance_entries WHERE user_id=$1) OR EXISTS(SELECT 1 FROM private.provider_usage_reservations WHERE user_id=$1) OR EXISTS(SELECT 1 FROM private.message_records WHERE user_id=$1) OR EXISTS(SELECT 1 FROM private.stored_files WHERE user_id=$1) OR EXISTS(SELECT 1 FROM private.video_rooms WHERE user_id=$1)) AS retained_launch_records,
      EXISTS(SELECT 1 FROM private.host_payment_accounts WHERE user_id=$1) AS payouts,
      (EXISTS(SELECT 1 FROM private.appointment_payments WHERE user_id=$1)
        OR EXISTS(SELECT 1 FROM private.marketplace_orders WHERE user_id=$1)) AS payments,
      (EXISTS(SELECT 1 FROM private.signature_envelopes WHERE user_id=$1)
        OR EXISTS(SELECT 1 FROM private.signing_documents WHERE user_id=$1)) AS documents`,
    [userId],
  );
  const r = rows[0],
    blockers: { id: string; message: string; href?: string }[] = [];
  if(r.retained_launch_records) blockers.push({id:"retained_records",message:"Messaging, usage, stored files or credit history needs a retention review. Contact support to close your account."});
  if (r.admin)
    blockers.push({ id: "admin", message: "Platform administrator accounts can’t be deleted here." });
  if (r.subscription)
    blockers.push({ id: "subscription", message: "Cancel your paid plan first.", href: "/app/billing" });
  if (r.team)
    blockers.push({ id: "team", message: "You own a team workspace. Remove it or hand it over first.", href: "/app/team" });
  if (r.google)
    blockers.push({ id: "google", message: "Disconnect your Google and Microsoft calendars before closing the account.", href: "/app/connections" });
  if (r.payouts)
    blockers.push({ id: "payouts", message: "Your account has a connected payout account. Contact support to close it." });
  if (r.payments)
    blockers.push({ id: "payments", message: "Payment and order records must be retained. Contact support to close your account." });
  if (r.documents)
    blockers.push({ id: "documents", message: "Signed and sent documents are retained for their signers. Contact support to close your account." });
  return blockers;
}

export async function deleteAccount(userId: string, password: string) {
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    // Serialise with concurrent writes for this account.
    await db.query('SELECT 1 FROM public."user" WHERE id=$1 FOR UPDATE', [userId]);
    if ((await deletionBlockers(userId)).length)
      throw new ApiError("This account still has records that need attention.", 409);
    const { rows } = await db.query(
      `SELECT password FROM public.account WHERE "userId"=$1 AND "providerId"='credential'`,
      [userId],
    );
    if (!rows[0]?.password || !(await verifyPassword({ hash: rows[0].password, password })))
      throw new ApiError("That password isn’t correct.", 403);
    for (const table of [
      "private.client_activity",
      "private.google_calendar_cleanup",
      "private.marketplace_artwork",
      "private.entitlement_overrides",
      "private.team_event_staff",
      "private.memberships",
    ])
      await db.query(`DELETE FROM ${table} WHERE user_id=$1`, [userId]);
    await db.query(
      "INSERT INTO private.admin_audit_log(action,details) VALUES('account_self_deleted',$1)",
      [{ deleted_at: new Date().toISOString() }],
    );
    // Profiles, sessions, appointments, clients and settings cascade from here.
    await db.query('DELETE FROM public."user" WHERE id=$1', [userId]);
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
