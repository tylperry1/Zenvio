import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import {
  session,
  sameOrigin,
  body,
  failure,
  uuid,
  string,
  integer,
  ApiError,
} from "@/lib/server";
import { requireCapacity } from "@/lib/entitlements";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const { token } = await session();
    const [rules, runs] = await Promise.all([
      getPool().query(
        "SELECT * FROM private.workflow_rules WHERE user_id=$1 ORDER BY created_at DESC",
        [token],
      ),
      getPool().query(
        "SELECT * FROM private.workflow_runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
        [token],
      ),
    ]);
    return Response.json(
      { rules: rules.rows, runs: runs.rows },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    sameOrigin(req);
    const { token } = await session(),
      v = await body(req),
      db = await getPool().connect();
    try {
      await db.query("BEGIN");
      if (v.action === "retry") {
        const r = await db.query(
          "UPDATE private.workflow_runs SET status='queued',last_error=NULL WHERE id=$1 AND user_id=$2 AND status='failed' RETURNING id",
          [uuid(v.id), token],
        );
        if (!r.rowCount) throw new ApiError("Failed execution not found.", 404);
      } else if (v.action === "toggle") {
        const rule = (
          await db.query(
            "SELECT * FROM private.workflow_rules WHERE id=$1 AND user_id=$2 FOR UPDATE",
            [uuid(v.id), token],
          )
        ).rows[0];
        if (!rule) throw new ApiError("Workflow not found.", 404);
        if (v.enabled === true && !rule.enabled)
          await requireCapacity(db, token, "workflows");
        await db.query(
          "UPDATE private.workflow_rules SET enabled=$3 WHERE id=$1 AND user_id=$2",
          [rule.id, token, v.enabled === true],
        );
        if (v.enabled !== true)
          await db.query(
            "UPDATE private.delivery_jobs SET status='cancelled',payload_ciphertext=NULL WHERE workflow_rule_id=$1 AND status='queued'",
            [rule.id],
          );
      } else if (v.action === "create") {
        const trigger = string(v.trigger, "trigger", 40),
          action = string(v.workflow_action, "action", 40);
        const allowed: Record<string, string[]> = {
          after_booking: [
            "email_guest",
            "email_host",
            "prepare_agreement",
            "send_agreement",
          ],
          before_appointment: ["email_guest", "email_host"],
          after_appointment: ["email_guest", "email_host"],
          document_completed: ["email_host", "create_task"],
        };
        if (!allowed[trigger]?.includes(action))
          throw new ApiError("This trigger/action pair is not supported.");
        const event = v.event_id ? uuid(v.event_id) : null;
        if (
          event &&
          !(
            await db.query(
              "SELECT 1 FROM public.event_types WHERE id=$1 AND user_id=$2",
              [event, token],
            )
          ).rowCount
        )
          throw new ApiError("Appointment type not found.", 404);
        let template = null;
        if (action.includes("agreement")) {
          template = uuid(v.template_id);
          const t = (
            await db.query(
              "SELECT v.roles FROM private.pdf_templates t JOIN private.pdf_template_versions v ON v.template_id=t.id AND v.version=t.current_version WHERE t.id=$1 AND t.user_id=$2 AND NOT t.archived",
              [template, token],
            )
          ).rows[0];
          if (!t || t.roles.length !== 1)
            throw new ApiError(
              "Automatic agreements require one guest role. Use a single-recipient template.",
            );
        }
        await db.query(
          "INSERT INTO private.workflow_rules(user_id,event_id,name,trigger,action,template_id,minutes,subject,message) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            token,
            event,
            string(v.name, "workflow name", 100),
            trigger,
            action,
            template,
            integer(v.minutes ?? 60, "minutes", 0, 10080),
            string(v.subject || "Zenvio update", "subject", 150),
            string(v.message || "", "message", 2000, 0),
          ],
        );
      } else throw new ApiError("Invalid action.");
      await db.query("COMMIT");
      return Response.json({ ok: true });
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  } catch (e) {
    return failure(e);
  }
}
