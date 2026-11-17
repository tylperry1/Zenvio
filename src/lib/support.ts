import type { NextRequest } from "next/server";
import { adminSession, adminAccess, canAccess } from "./admin";
import { allowRequest } from "./booking-protection";
import { getPool } from "./db";
import { queueDelivery, appOrigin } from "./lifecycle";
import { attachmentResponse, normalizeAttachment, readUpload } from "./uploads";
import { ApiError, body, sameOrigin, session, string, uuid } from "./server";
import { isSupportCategory, normalizeSupportStatus, supportPriorities } from "./support-options";
import { queueStaffAlert, queueVisitorReply } from "./support-notify";
import { applySlaDeadlines } from "./support-sla";

const AGENT_ONLINE_MINUTES = 3;
type Q = { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };

/** Whether any employee is marked available and active in the last few minutes. */
export async function supportOnline(db: Q = getPool()) {
  const { rows } = await db.query(
    "SELECT count(*)::int n FROM private.support_agents WHERE available AND last_seen_at > now()-make_interval(mins => $1)",
    [AGENT_ONLINE_MINUTES],
  );
  return rows[0].n > 0;
}

/** Records that an employee has the console open; optionally changes availability. */
export async function agentHeartbeat(userId: string, available?: boolean, db: Q = getPool()) {
  const { rows } = await db.query(
    `INSERT INTO private.support_agents(user_id,available,last_seen_at) VALUES($1,coalesce($2,false),now())
     ON CONFLICT (user_id) DO UPDATE SET available=coalesce($2,private.support_agents.available),last_seen_at=now() RETURNING available`,
    [userId, available ?? null],
  );
  return rows[0].available as boolean;
}

/** Employees who can take conversations: the master admin and staff with the support permission. */
async function supportTeam(db: Q) {
  return (
    await db.query(
      `SELECT u.id,u.name,coalesce(a.available,false) AND a.last_seen_at > now()-make_interval(mins => $1) online
         FROM public."user" u LEFT JOIN private.support_agents a ON a.user_id=u.id
        WHERE u.id IN (SELECT user_id FROM private.platform_roles WHERE enabled
                       UNION SELECT user_id FROM private.staff_members WHERE enabled AND 'support'=any(permissions))
        ORDER BY u.name`,
      [AGENT_ONLINE_MINUTES],
    )
  ).rows;
}

async function supportCounts(db: Q, me: string) {
  return (
    await db.query(
      `SELECT count(*) FILTER (WHERE status IN ('new','open','in_progress','escalated'))::int open,
              count(*) FILTER (WHERE status='waiting_customer')::int pending,
              count(*) FILTER (WHERE status NOT IN ('resolved','closed') AND assigned_to IS NULL AND merged_into IS NULL)::int unassigned,
              count(*) FILTER (WHERE status NOT IN ('resolved','closed') AND assigned_to=$1 AND merged_into IS NULL)::int mine,
              count(*) FILTER (WHERE status NOT IN ('resolved','closed') AND user_id IS NULL AND merged_into IS NULL)::int visitors,
              count(*) FILTER (WHERE status='waiting_internal')::int waiting_internal,
              count(*) FILTER (WHERE status='escalated')::int escalated,
              count(*) FILTER (WHERE status NOT IN ('resolved','closed') AND (sla_first_breached OR sla_resolve_breached))::int sla_breached,
              count(*) FILTER (WHERE resolved_at::date = current_date)::int resolved_today,
              (SELECT coalesce(max(id),0) FROM private.support_messages WHERE NOT staff)::text latest_customer,
              round(avg(extract(epoch FROM first_response_at-created_at)/60) FILTER (WHERE first_response_at IS NOT NULL AND created_at > now()-interval '30 days'))::int first_response_minutes,
              round(avg(extract(epoch FROM resolved_at-created_at)/60) FILTER (WHERE resolved_at IS NOT NULL AND created_at > now()-interval '30 days'))::int resolve_minutes,
              round(avg(rating) FILTER (WHERE rating IS NOT NULL AND created_at > now()-interval '30 days'),1)::float rating,
              count(rating) FILTER (WHERE created_at > now()-interval '30 days')::int ratings
         FROM private.support_tickets`,
      [me],
    )
  ).rows[0];
}

/** Change signature for a signed-in customer's live stream. */
export async function customerSignature(userId: string) {
  const { rows } = await getPool().query(
    `SELECT coalesce(max(m.id),0)::text m,max(t.updated_at)::text u FROM private.support_tickets t
       LEFT JOIN private.support_messages m ON m.ticket_id=t.id AND NOT m.internal WHERE t.user_id=$1`,
    [userId],
  );
  return { ...rows[0], online: await supportOnline() };
}

/** Change signature for the employee inbox: any new message or ticket change. */
export async function staffSignature() {
  const { rows } = await getPool().query(
    `SELECT (SELECT coalesce(max(id),0) FROM private.support_messages)::text m,
            (SELECT max(updated_at) FROM private.support_tickets)::text u`,
  );
  return rows[0];
}

export async function supportGet(request: NextRequest, staff: boolean) {
  const current = staff ? await adminSession("support") : await session();
  const db = getPool();
  if (staff && request.nextUrl.searchParams.get("summary")) return { counts: await supportCounts(db, current.token) };
  const ticket = request.nextUrl.searchParams.get("ticket");
  if (ticket) {
    const id = uuid(ticket);
    const found = await db.query("SELECT id FROM private.support_tickets WHERE id=$1 AND ($2::boolean OR user_id=$3)", [id, staff, current.token]);
    if (!found.rowCount) throw new ApiError("Conversation not found.", 404);
    const after = request.nextUrl.searchParams.get("after") ?? "0";
    if (!/^\d{1,18}$/.test(after)) throw new ApiError("Invalid message cursor.");
    const messages = await db.query(
      `SELECT id::text,sender_id,staff,internal,content,created_at,EXISTS(SELECT 1 FROM private.support_attachments a WHERE a.message_id=m.id) attachment FROM private.support_messages m
       WHERE ticket_id=$1 AND ($2::boolean OR NOT internal) AND id>$3::bigint ORDER BY id LIMIT 100`,
      [id, staff, after],
    );
    // Mark only messages returned to this viewer. New arrivals retain their unread state.
    const last = messages.rows.at(-1)?.id;
    if (last) await db.query(
      `UPDATE private.support_tickets SET ${staff ? "staff_read" : "customer_read"}=greatest(${staff ? "staff_read" : "customer_read"},$2::bigint) WHERE id=$1`,
      [id, last],
    );
    const result: Record<string, unknown> = { messages: messages.rows, hasMore: messages.rows.length === 100 };
    if (after === "0") {
      result.ticket = (
        await db.query(
          `SELECT t.id,t.subject,t.status,t.category,t.priority,t.rating,t.created_at,t.updated_at,t.assigned_to,t.first_response_at,t.resolved_at
                  ${staff ? ',t.page,t.user_id,coalesce(u.name,t.visitor_name) customer_name,coalesce(u.email,t.visitor_email) customer_email,u."createdAt" customer_since,a.name assignee_name,(t.user_id IS NULL) visitor' : ""}
             FROM private.support_tickets t LEFT JOIN public."user" u ON u.id=t.user_id LEFT JOIN public."user" a ON a.id=t.assigned_to WHERE t.id=$1`,
          [id],
        )
      ).rows[0];
      if (staff) {
        const meta = result.ticket as { user_id: string | null; customer_email: string };
        // Earlier conversations: the account's, or a visitor's earlier chats from the same email.
        const [history, feedback] = await Promise.all([
          db.query(
            `SELECT id,subject,status,created_at FROM private.support_tickets
              WHERE id<>$2 AND (user_id=$1 OR ($1::uuid IS NULL AND user_id IS NULL AND lower(visitor_email)=lower($3)))
              ORDER BY created_at DESC LIMIT 5`,
            [meta.user_id, id, meta.customer_email],
          ),
          meta.user_id
            ? db.query("SELECT id,category,message,status,created_at FROM private.feedback WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5", [meta.user_id])
            : Promise.resolve({ rows: [] }),
        ]);
        result.history = history.rows;
        result.feedback = feedback.rows;
      }
    }
    return result;
  }
  const params = request.nextUrl.searchParams;
  const rawStatus = params.get("status") ?? "";
  const status =
    rawStatus === "pending"
      ? "waiting_customer"
      : rawStatus === "active" || rawStatus === ""
        ? rawStatus
        : normalizeSupportStatus(rawStatus) || "";
  if (rawStatus && rawStatus !== "active" && rawStatus !== "pending" && !status) throw new ApiError("Invalid status.");
  const q = string(params.get("q") ?? "", "search", 100, 0);
  const page = Number(params.get("page") ?? 0);
  if (!Number.isSafeInteger(page) || page < 0 || page > 10000) throw new ApiError("Invalid page.");
  const view = staff ? params.get("view") ?? "" : "";
  const category = isSupportCategory(params.get("category")) ? params.get("category")! : "";
  const filterStatus = status === "active" ? "active" : status;
  const tickets = await db.query(
    `SELECT t.id,t.subject,t.status,t.assigned_to,t.updated_at,t.created_at,t.category,t.priority,t.rating,coalesce(u.name,t.visitor_name) name,
       ${staff ? "coalesce(u.email,t.visitor_email) email,a.name assignee_name,(t.user_id IS NULL) visitor,t.escalation_level,t.sla_first_due_at,t.sla_resolve_due_at,t.sla_first_breached,t.sla_resolve_breached," : ""}
       (SELECT CASE WHEN EXISTS(SELECT 1 FROM private.support_attachments a WHERE a.message_id=m.id) THEN 'Image: '||m.content ELSE m.content END
          FROM private.support_messages m WHERE m.ticket_id=t.id AND NOT m.internal ORDER BY m.id DESC LIMIT 1) preview,
       (SELECT count(*)::int FROM private.support_messages m WHERE m.ticket_id=t.id AND NOT m.internal
        AND m.staff<>$1 AND m.id>CASE WHEN $1 THEN t.staff_read ELSE t.customer_read END) unread
       FROM private.support_tickets t LEFT JOIN public."user" u ON u.id=t.user_id LEFT JOIN public."user" a ON a.id=t.assigned_to
       WHERE ($1::boolean OR t.user_id=$2) AND coalesce(t.merged_into::text,'')=''
       AND ($3='' OR t.status=$3 OR ($3='active' AND t.status NOT IN ('resolved','closed')))
       AND ($4='' OR strpos(lower(t.subject),lower($4))>0 OR ($1 AND (strpos(lower(coalesce(u.email,t.visitor_email)),lower($4))>0 OR strpos(lower(coalesce(u.name,t.visitor_name,'')),lower($4))>0)))
       AND ($6='' OR ($6='mine' AND t.assigned_to=$2) OR ($6='unassigned' AND t.assigned_to IS NULL) OR ($6='visitors' AND t.user_id IS NULL) OR ($6='escalated' AND t.status='escalated') OR ($6='sla' AND (t.sla_first_breached OR t.sla_resolve_breached)))
       AND ($7='' OR t.category=$7)
       ORDER BY CASE WHEN $1 AND t.status NOT IN ('resolved','closed') THEN CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END ELSE 2 END,
                t.updated_at DESC,t.id LIMIT 31 OFFSET $5`,
    [staff, current.token, filterStatus === "active" ? "active" : filterStatus, q, page * 30, view, category],
  );
  if (!staff) return { tickets: tickets.rows.slice(0, 30), hasMore: tickets.rows.length > 30, replies: [], online: await supportOnline(db) };
  const [replies, counts, team, available, alerts] = await Promise.all([
    db.query("SELECT id,title,content FROM private.support_replies ORDER BY title LIMIT 100"),
    supportCounts(db, current.token),
    supportTeam(db),
    agentHeartbeat(current.token, undefined, db),
    db.query("SELECT email_alerts FROM private.support_agents WHERE user_id=$1", [current.token]),
  ]);
  return {
    tickets: tickets.rows.slice(0, 30), hasMore: tickets.rows.length > 30, replies: replies.rows, counts, team, available,
    emailAlerts: alerts.rows[0]?.email_alerts ?? true, me: current.token,
  };
}

export async function supportPost(request: NextRequest, staff: boolean) {
  sameOrigin(request);
  const current = staff ? await adminSession("support") : await session();
  if (!(await allowRequest("support-post", current.token, 60, 3600))) throw new ApiError("Too many messages. Please try again later.", 429);
  const input = await body(request);
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    if (staff && input.action === "save-reply") {
      await db.query("INSERT INTO private.support_replies(title,content) VALUES($1,$2)",
        [string(input.title, "title", 100), string(input.content, "reply", 4000)]);
      await db.query("INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'support_reply_saved','{}')", [current.token]);
      await db.query("COMMIT");
      return { ok: true };
    }
    if (staff && input.action === "delete-reply") {
      await db.query("DELETE FROM private.support_replies WHERE id=$1", [uuid(input.id)]);
      await db.query("INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'support_reply_deleted','{}')", [current.token]);
      await db.query("COMMIT");
      return { ok: true };
    }
    if (staff && input.action === "availability") {
      const available = await agentHeartbeat(current.token, input.available === true, db);
      await db.query("COMMIT");
      return { ok: true, available };
    }
    if (staff && input.action === "email-alerts") {
      const { rows } = await db.query(
        `INSERT INTO private.support_agents(user_id,email_alerts) VALUES($1,$2)
         ON CONFLICT (user_id) DO UPDATE SET email_alerts=$2 RETURNING email_alerts`,
        [current.token, input.enabled === true],
      );
      await db.query("COMMIT");
      return { ok: true, emailAlerts: rows[0].email_alerts };
    }
    if (staff && input.action === "suggestion") {
      // Files a customer's message in the Suggestions & feedback inbox.
      const filed = await db.query(
        `INSERT INTO private.feedback(user_id,category,message,page)
         SELECT t.user_id,'idea',m.content,'support:'||t.id FROM private.support_messages m JOIN private.support_tickets t ON t.id=m.ticket_id
          WHERE m.id=$1 AND NOT m.staff AND NOT EXISTS (SELECT 1 FROM private.support_attachments a WHERE a.message_id=m.id) RETURNING id`,
        [/^\d{1,18}$/.test(String(input.message)) ? String(input.message) : "0"],
      );
      if (!filed.rowCount) throw new ApiError("Only a customer’s written message can be filed as a suggestion.", 404);
      await db.query("INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'support_suggestion_filed',$2)", [current.token, JSON.stringify({ message: String(input.message), feedback: filed.rows[0].id })]);
      await db.query("COMMIT");
      return { ok: true, feedback: filed.rows[0].id };
    }
    const reference = input.action === "message" || input.action === "create" ? uuid(input.reference) : null;
    const content = reference ? string(input.content, "message", 4000) : "";
    let id: string;
    if (input.action === "create") {
      if (staff) throw new ApiError("Create conversations from your workspace.");
      // Serialize concurrent ticket creation and enforce an account-level open-ticket limit.
      await db.query('SELECT id FROM public."user" WHERE id=$1 FOR UPDATE', [current.token]);
      const existing = await db.query("SELECT ticket_id FROM private.support_messages WHERE reference=$1 AND sender_id=$2", [reference, current.token]);
      if (existing.rowCount) {
        await db.query("COMMIT");
        return { ok: true, id: existing.rows[0].ticket_id };
      }
      const count = await db.query("SELECT count(*)::int n FROM private.support_tickets WHERE user_id=$1 AND status<>'resolved'", [current.token]);
      if (count.rows[0].n >= 10) throw new ApiError("You have 10 active conversations. Reply to an existing conversation.", 409);
      id = (await db.query(
        "INSERT INTO private.support_tickets(user_id,subject,category,page,status,last_customer_at) VALUES($1,$2,$3,$4,'new',now()) RETURNING id",
        [current.token, string(input.subject, "subject", 150), isSupportCategory(input.category) ? input.category : "other",
         typeof input.page === "string" ? input.page.slice(0, 300) : ""],
      )).rows[0].id;
      await db.query(
        "INSERT INTO private.support_ticket_events(ticket_id,actor_id,kind,details) VALUES($1,$2,'created',$3::jsonb)",
        [id, current.token, JSON.stringify({ subject: string(input.subject, "subject", 150) })],
      ).catch(() => null);
      await applySlaDeadlines(db, id, "normal").catch(() => null);
    } else {
      id = uuid(input.ticket);
    }
    const ticket = (await db.query('SELECT t.*,coalesce(u.email,t.visitor_email) email FROM private.support_tickets t LEFT JOIN public."user" u ON u.id=t.user_id WHERE t.id=$1 AND ($2::boolean OR t.user_id=$3) FOR UPDATE OF t',
      [id, staff, current.token])).rows[0];
    if (!ticket) throw new ApiError("Conversation not found.", 404);
    if (reference) {
      const internal = staff && input.internal === true;
      const inserted = await db.query(
        `INSERT INTO private.support_messages(ticket_id,sender_id,staff,internal,content,reference)
         VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(reference) DO NOTHING RETURNING id`,
        [id, current.token, staff, internal, content, reference]);
      if (!inserted.rowCount) {
        const prior = (await db.query("SELECT ticket_id,sender_id,content,internal FROM private.support_messages WHERE reference=$1", [reference])).rows[0];
        if (prior.ticket_id !== id || prior.sender_id !== current.token || prior.content !== content || prior.internal !== internal) throw new ApiError("Message reference already used.", 409);
      } else {
        // Staff may hand the conversation back to the customer or resolve it.
        const requested = staff && !internal ? normalizeSupportStatus(input.status) : null;
        const after =
          requested === "waiting_customer" || requested === "resolved" || requested === "waiting_internal" || requested === "in_progress"
            ? requested
            : staff && !internal && (input.status === "pending" || input.status === "resolved")
              ? input.status === "pending"
                ? "waiting_customer"
                : "resolved"
              : null;
        await db.query(
          `UPDATE private.support_tickets SET updated_at=now(),
             status=CASE WHEN $2 THEN status WHEN $4::text IS NOT NULL THEN $4::text WHEN $3 THEN 'waiting_customer' ELSE 'open' END,
             resolved_at=CASE WHEN $2 THEN resolved_at WHEN $4::text='resolved' THEN coalesce(resolved_at,now()) ELSE NULL END,
             first_response_at=CASE WHEN $3 AND NOT $2 THEN coalesce(first_response_at,now()) ELSE first_response_at END,
             last_staff_at=CASE WHEN $3 AND NOT $2 THEN now() ELSE last_staff_at END,
             last_customer_at=CASE WHEN NOT $3 THEN now() ELSE last_customer_at END,
             closed_at=CASE WHEN $4::text='closed' THEN coalesce(closed_at,now()) ELSE closed_at END,
             reopened_at=CASE WHEN NOT $3 AND status IN ('resolved','closed') THEN now() ELSE reopened_at END
           WHERE id=$1`,
          [id, internal, staff, after]);
        if (staff && !internal && !ticket.user_id) await queueVisitorReply(db, ticket, reference);
        else if (staff && !internal) await queueDelivery(db, {
          user: ticket.user_id, kind: "support_reply", key: "support:" + reference, to: ticket.email,
          subject: `New reply: ${ticket.subject}`.slice(0, 200),
          text: `The Zenvio support team replied to your conversation “${ticket.subject}”.\n\nRead the reply and respond in Zenvio:\n${appOrigin()}/app/support?ticket=${id}\n\nPlease reply in Zenvio rather than to this email so the team sees your message.`,
        });
        if (!staff) await queueStaffAlert(db, id, input.action === "create" ? "staff_new_ticket" : "staff_customer_reply");
        await db.query(
          "INSERT INTO private.support_ticket_events(ticket_id,actor_id,kind,details) VALUES($1,$2,$3,$4::jsonb)",
          [id, current.token, internal ? "internal_note" : staff ? "staff_message" : "customer_message", JSON.stringify({ reference })],
        ).catch(() => null);
      }
    } else if (input.action === "update") {
      const status = normalizeSupportStatus(input.status ?? ticket.status);
      if (!status) throw new ApiError("Invalid status.");
      let assigned = ticket.assigned_to;
      if (staff && input.assigned !== undefined) {
        assigned = input.assigned === "self" ? current.token : input.assigned ? uuid(input.assigned) : null;
        if (assigned && !canAccess(await adminAccess(assigned), "support")) throw new ApiError("Assign an authorized support employee.", 400);
      }
      let priority = ticket.priority;
      if (staff && input.priority !== undefined) {
        if (!(supportPriorities as readonly string[]).includes(String(input.priority))) throw new ApiError("Invalid priority.");
        priority = String(input.priority);
      }
      const resolutionNotes =
        staff && typeof input.resolution_notes === "string"
          ? string(input.resolution_notes, "resolution notes", 4000, 0)
          : ticket.resolution_notes || "";
      await db.query(
        `UPDATE private.support_tickets SET status=$2,assigned_to=$3,priority=$4,updated_at=now(),
           resolution_notes=CASE WHEN $2 IN ('resolved','closed') THEN $5 ELSE resolution_notes END,
           resolved_at=CASE WHEN $2 IN ('resolved','closed') THEN coalesce(resolved_at,now()) ELSE NULL END,
           closed_at=CASE WHEN $2='closed' THEN coalesce(closed_at,now()) WHEN $2='resolved' THEN closed_at ELSE NULL END,
           reopened_at=CASE WHEN $2 NOT IN ('resolved','closed') AND status IN ('resolved','closed') THEN now() ELSE reopened_at END
         WHERE id=$1`,
        [id, status, assigned, priority, resolutionNotes]);
      await db.query(
        "INSERT INTO private.support_ticket_events(ticket_id,actor_id,kind,details) VALUES($1,$2,'updated',$3::jsonb)",
        [id, current.token, JSON.stringify({ status, assigned, priority })],
      ).catch(() => null);
    } else if (!staff && input.action === "rate") {
      const rating = Number(input.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ApiError("Choose a rating from 1 to 5.");
      if (ticket.status !== "resolved") throw new ApiError("You can rate a conversation once it’s resolved.", 409);
      await db.query("UPDATE private.support_tickets SET rating=$2 WHERE id=$1", [id, rating]);
    } else throw new ApiError("Unknown action.");
    if (staff) await db.query("INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'support_updated',$2)",
      [current.token, JSON.stringify({ ticket: id, action: input.action, internal: input.internal === true, ...(input.priority !== undefined && { priority: String(input.priority) }) })]);
    await db.query("COMMIT");
    return { ok: true, id };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
}


export async function supportAttachment(request: NextRequest, staff: boolean, upload: boolean) {
  if (upload) sameOrigin(request);
  const current = staff ? await adminSession("support") : await session();
  if (!upload) {
    const message = request.nextUrl.searchParams.get("message") ?? "";
    if (!/^\d{1,18}$/.test(message)) throw new ApiError("Invalid attachment.");
    const result = await getPool().query(
      `SELECT a.data,a.content_type,a.filename FROM private.support_attachments a
       JOIN private.support_messages m ON m.id=a.message_id JOIN private.support_tickets t ON t.id=m.ticket_id
       WHERE m.id=$1 AND ($2::boolean OR (t.user_id=$3 AND NOT m.internal))`,
      [message, staff, current.token],
    );
    if (!result.rowCount) throw new ApiError("Attachment not found.", 404);
    return attachmentResponse(result.rows[0]);
  }
  if (!(await allowRequest("support-upload", current.token, 20, 3600))) throw new ApiError("Too many uploads. Try again later.", 429);
  const ticketId = uuid(request.nextUrl.searchParams.get("ticket"));
  const reference = uuid(request.nextUrl.searchParams.get("reference"));
  const source = await readUpload(request, 2000000, "image");
  const file = await normalizeAttachment(source, request.nextUrl.searchParams.get("filename") ?? "image");
  if (file.contentType !== "image/jpeg" || file.data.length > 2000000) throw new ApiError("Choose a JPEG, PNG or WebP image under 2 MB.", 415);
  const internal = staff && request.nextUrl.searchParams.get("internal") === "true";
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    await db.query('SELECT id FROM public."user" WHERE id=$1 FOR UPDATE', [current.token]);
    const ticket = (await db.query(
      'SELECT t.*,u.email FROM private.support_tickets t LEFT JOIN public."user" u ON u.id=t.user_id WHERE t.id=$1 AND ($2::boolean OR t.user_id=$3) FOR UPDATE OF t',
      [ticketId, staff, current.token],
    )).rows[0];
    if (!ticket) throw new ApiError("Conversation not found.", 404);
    if (!ticket.user_id) throw new ApiError("Images can’t be shared with website visitors. Send a written reply instead.", 409);
    const prior = await db.query("SELECT ticket_id,sender_id FROM private.support_messages WHERE reference=$1", [reference]);
    if (prior.rowCount) {
      if (prior.rows[0].ticket_id !== ticketId || prior.rows[0].sender_id !== current.token) throw new ApiError("Upload reference already used.", 409);
      await db.query("COMMIT");
      return Response.json({ ok: true });
    }
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["support-upload:" + ticket.user_id]);
    const quota = (await db.query(
      `SELECT count(*) FILTER (WHERE m.ticket_id=$2)::int ticket_count,
       coalesce(sum(octet_length(a.data)),0)::bigint total_bytes FROM private.support_attachments a
       JOIN private.support_messages m ON m.id=a.message_id JOIN private.support_tickets t ON t.id=m.ticket_id
       WHERE t.user_id=$1`, [ticket.user_id, ticketId],
    )).rows[0];
    if (quota.ticket_count >= 10 || Number(quota.total_bytes) + file.data.length > 20000000) throw new ApiError("Support attachment limit reached. Contact the team for another secure sharing option.", 409);
    const message = (await db.query(
      "INSERT INTO private.support_messages(ticket_id,sender_id,staff,internal,content,reference) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
      [ticketId, current.token, staff, internal, file.filename, reference],
    )).rows[0];
    await db.query("INSERT INTO private.support_attachments(message_id,content_type,filename,data) VALUES($1,$2,$3,$4)", [message.id, file.contentType, file.filename, file.data]);
    await db.query("UPDATE private.support_tickets SET updated_at=now(),status=CASE WHEN $2 THEN status ELSE 'open' END WHERE id=$1", [ticketId, internal]);
    if (staff) {
      await db.query("INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'support_attachment_added',$2)", [current.token, JSON.stringify({ ticket: ticketId, internal })]);
      if (!internal) await queueDelivery(db, {
        user: ticket.user_id, kind: "support_reply", key: "support:" + reference, to: ticket.email,
        subject: `New image: ${ticket.subject}`.slice(0, 200), text: `The Zenvio support team shared an image in your conversation “${ticket.subject}”.\n\nView it in Zenvio:\n${appOrigin()}/app/support?ticket=${ticketId}`,
      });
    }
    await db.query("COMMIT");
    return Response.json({ ok: true });
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}
