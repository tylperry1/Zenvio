import { entitlementUsage } from "./entitlements";
import { getPool } from "./db";
import { queueDelivery } from "./lifecycle";
import { instantiateTemplate } from "./pdf-templates";
import { queueEnvelopeInvitation } from "./document-delivery";
import { signingToken } from "./document-signing";
import { hash, manifest } from "./envelopes";
export async function scheduleWorkflows(user?: string) {
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    const rules = (
      await db.query(
        `SELECT r.*,u.email host_email FROM private.workflow_rules r JOIN public."user" u ON u.id=r.user_id WHERE r.enabled ${user ? "AND r.user_id=$1" : ""} ORDER BY r.created_at`,
        user ? [user] : [],
      )
    ).rows;
    const limits = new Map<string, number>();
    for (const r of rules) {
      if (!limits.has(r.user_id)) {
        const usage = await entitlementUsage(r.user_id, db);
        limits.set(
          r.user_id,
          usage.usage.workflows <= usage.limits.workflows
            ? usage.limits.workflows
            : 0,
        );
      }
      if (!limits.get(r.user_id)) continue;
      const sources =
        r.trigger === "document_completed"
          ? (
              await db.query(
                "SELECT e.id,e.contact_id,e.completed_at FROM private.signature_envelopes e WHERE e.user_id=$1 AND e.status='completed' AND e.completed_at>=$2",
                [r.user_id, r.created_at],
              )
            ).rows
          : (
              await db.query(
                "SELECT b.*,e.title FROM public.bookings b JOIN public.event_types e ON e.id=b.event_id WHERE b.user_id=$1 AND b.status='confirmed' AND b.created_at>=$2 AND ($3::uuid IS NULL OR b.event_id=$3) AND b.ends_at>now()-interval '7 days' AND NOT EXISTS(SELECT 1 FROM private.workflow_runs w WHERE w.rule_id=$4 AND w.booking_id=b.id AND w.dedupe_key='workflow:'||$4::text||':'||b.id||':'||CASE WHEN $5='after_booking' THEN '0' ELSE b.revision::text END AND w.status IN ('completed','failed')) ORDER BY b.created_at LIMIT 200",
                [r.user_id, r.created_at, r.event_id, r.id, r.trigger],
              )
            ).rows;
      for (const b of sources) {
        const key = `workflow:${r.id}:${b.id}:${r.trigger === "after_booking" ? 0 : b.revision || 0}`;
        const run = await db.query(
          "INSERT INTO private.workflow_runs(rule_id,user_id,booking_id,envelope_id,dedupe_key,status) VALUES($1,$2,$3,$4,$5,'queued') ON CONFLICT(dedupe_key) DO UPDATE SET last_error=NULL WHERE private.workflow_runs.status='queued' RETURNING id",
          [
            r.id,
            r.user_id,
            r.trigger === "document_completed" ? null : b.id,
            r.trigger === "document_completed" ? b.id : null,
            key,
          ],
        );
        if (!run.rowCount) continue;
        await db.query("SAVEPOINT workflow_action");
        try {
          const at =
            r.trigger === "before_appointment"
              ? new Date(new Date(b.starts_at).getTime() - r.minutes * 60000)
              : r.trigger === "after_appointment"
                ? new Date(new Date(b.ends_at).getTime() + r.minutes * 60000)
                : new Date();
          if (r.action === "email_guest" || r.action === "email_host") {
            const to = r.action === "email_host" ? r.host_email : b.guest_email;
            if (!to) throw Error("Workflow recipient unavailable");
            await queueDelivery(db, {
              user: r.user_id,
              kind: "workflow_" + r.trigger,
              key,
              to,
              subject: r.subject,
              text: r.message,
              at,
              booking: r.trigger === "document_completed" ? undefined : b.id,
              revision: b.revision,
              expires: new Date(
                (r.trigger === "after_appointment"
                  ? new Date(b.ends_at).getTime()
                  : Date.now()) +
                  7 * 86400000,
              ),
            });
            await db.query(
              "UPDATE private.delivery_jobs SET workflow_rule_id=$2 WHERE dedupe_key=$1",
              [key, r.id],
            );
          } else if (r.action === "create_task") {
            await db.query(
              "INSERT INTO private.client_tasks(user_id,contact_id,title) VALUES($1,$2,$3)",
              [r.user_id, b.contact_id, r.subject],
            );
          } else {
            const id = await instantiateTemplate(
              db,
              r.user_id,
              r.template_id,
              [{ name: b.guest_name, email: b.guest_email }],
              b.contact_id,
              b.id,
            );
            if (r.action === "send_agreement") {
              const e = (
                  await db.query(
                    "SELECT * FROM private.signature_envelopes WHERE id=$1",
                    [id],
                  )
                ).rows[0],
                recipients = (
                  await db.query(
                    "SELECT * FROM private.signature_recipients WHERE envelope_id=$1",
                    [id],
                  )
                ).rows;
              const digest = manifest(e.pdf, e.fields, recipients);
              for (const recipient of recipients) {
                const secret = signingToken();
                await db.query(
                  "UPDATE private.signature_recipients SET token_hash=$2 WHERE id=$1",
                  [recipient.id, hash(secret)],
                );
                await queueEnvelopeInvitation(db, e, recipient, secret);
              }
              await db.query(
                "UPDATE private.signature_envelopes SET status='sent',sent_at=now(),expires_at=now()+interval '14 days',content_hash=$2 WHERE id=$1",
                [id, digest],
              );
            }
          }
          await db.query(
            "UPDATE private.workflow_runs SET status='completed' WHERE id=$1",
            [run.rows[0].id],
          );
        } catch {
          await db.query("ROLLBACK TO SAVEPOINT workflow_action");
          await db.query(
            "UPDATE private.workflow_runs SET status='failed',last_error='Workflow could not complete. Review template, recipient roles, and plan limits, then retry.' WHERE id=$1",
            [run.rows[0].id],
          );
        }
      }
    }
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
