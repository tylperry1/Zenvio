import type { NextRequest } from "next/server";
import { adminAccess, adminSession, canAccess } from "./admin";
import { getPool } from "./db";
import { createPlatformAlert, staffRecipients } from "./platform-alerts";
import { ApiError, body, sameOrigin, string, uuid } from "./server";
import {
  defaultSupportCapabilities,
  isSupportCapability,
  isSupportCategory,
  normalizeSupportStatus,
  supportCapabilityKeys,
  supportPriorities,
  type SupportCapability,
} from "./support-options";
import { applySlaDeadlines, listSlaPolicies, refreshSlaBreaches, slaState } from "./support-sla";

type Q = { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };

/** Master admin: all caps. No agent row: defaults. Empty stored array: no caps (intentional revoke). */
export async function agentCapabilities(db: Q, userId: string, access: Awaited<ReturnType<typeof adminAccess>>) {
  if (access?.role === "master_admin") return [...supportCapabilityKeys] as SupportCapability[];
  const { rows } = await db.query(
    "SELECT capabilities FROM private.support_agents WHERE user_id=$1",
    [userId],
  );
  if (!rows[0]) return [...defaultSupportCapabilities];
  return Array.isArray(rows[0].capabilities)
    ? rows[0].capabilities.filter(isSupportCapability)
    : [...defaultSupportCapabilities];
}

export function requireCap(caps: SupportCapability[], need: SupportCapability) {
  if (!caps.includes(need)) throw new ApiError("You don’t have permission for that support action.", 403);
}

function redactTicketContact<T extends Record<string, unknown>>(ticket: T, caps: SupportCapability[]): T {
  const next = { ...ticket } as Record<string, unknown>;
  // Never expose visitor reply-link secrets to the browser.
  delete next.visitor_token_sealed;
  delete next.visitor_token_hash;
  if (!caps.includes("customer_contact")) {
    for (const key of ["customer_name", "customer_email", "email", "name", "visitor_name", "visitor_email"]) {
      if (key in next) next[key] = null;
    }
  }
  if (!caps.includes("customer_account") && "customer_since" in next) next.customer_since = null;
  return next as T;
}

async function recordEvent(db: Q, ticketId: string, actorId: string, kind: string, details: Record<string, unknown> = {}) {
  await db.query(
    "INSERT INTO private.support_ticket_events(ticket_id,actor_id,kind,details) VALUES($1,$2,$3,$4::jsonb)",
    [ticketId, actorId, kind, JSON.stringify(details)],
  );
}

export async function supportOpsDashboard(me: string) {
  const db = getPool();
  await refreshSlaBreaches(db).catch(() => null);
  const { rows } = await db.query(
    `SELECT
       count(*) FILTER (WHERE status NOT IN ('resolved','closed') AND merged_into IS NULL)::int open_tickets,
       count(*) FILTER (WHERE status NOT IN ('resolved','closed') AND assigned_to IS NULL AND merged_into IS NULL)::int unassigned,
       count(*) FILTER (WHERE status NOT IN ('resolved','closed') AND assigned_to=$1 AND merged_into IS NULL)::int mine,
       count(*) FILTER (WHERE status='waiting_customer' AND merged_into IS NULL)::int waiting_customer,
       count(*) FILTER (WHERE status='waiting_internal' AND merged_into IS NULL)::int waiting_internal,
       count(*) FILTER (WHERE status NOT IN ('resolved','closed') AND priority IN ('high','urgent') AND merged_into IS NULL)::int high_priority,
       count(*) FILTER (WHERE status='escalated' AND merged_into IS NULL)::int escalated,
       count(*) FILTER (WHERE status NOT IN ('resolved','closed') AND (sla_first_breached OR sla_resolve_breached) AND merged_into IS NULL)::int sla_breached,
       count(*) FILTER (WHERE status NOT IN ('resolved','closed') AND sla_resolve_due_at IS NOT NULL AND sla_resolve_due_at < now() + interval '4 hours' AND merged_into IS NULL)::int sla_due_soon,
       round(avg(extract(epoch FROM first_response_at-created_at)/60) FILTER (WHERE first_response_at IS NOT NULL AND created_at > now()-interval '30 days'))::int avg_first_response_minutes,
       round(avg(extract(epoch FROM resolved_at-created_at)/60) FILTER (WHERE resolved_at IS NOT NULL AND created_at > now()-interval '30 days'))::int avg_resolve_minutes,
       count(*) FILTER (WHERE resolved_at::date = current_date)::int resolved_today
     FROM private.support_tickets`,
    [me],
  );
  const metrics = rows[0];
  // Honest unknowns: averages stay null when no samples exist.
  return {
    metrics: {
      ...metrics,
      avg_first_response_minutes: metrics.avg_first_response_minutes ?? null,
      avg_resolve_minutes: metrics.avg_resolve_minutes ?? null,
    },
  };
}

export async function customerIntelligence(db: Q, userId: string | null, caps: SupportCapability[]) {
  if (!userId) return { visitor: true };
  const contact = caps.includes("customer_contact");
  const account = caps.includes("customer_account");
  const subscription = caps.includes("subscription_view");
  const billing = caps.includes("billing_view");

  const user = (
    await db.query(
      `SELECT id, name, email, "createdAt" created_at FROM public."user" WHERE id=$1`,
      [userId],
    )
  ).rows[0];
  if (!user) return null;

  const [sub, bookings, tickets, errors] = await Promise.all([
    subscription || billing
      ? db.query(
          `SELECT plan, status, seats, catalog_version, customer_id IS NOT NULL has_customer,
                  subscription_id IS NOT NULL has_subscription, updated_at
             FROM private.subscriptions WHERE user_id=$1`,
          [userId],
        )
      : Promise.resolve({ rows: [] }),
    account
      ? db.query(
          `SELECT b.id, coalesce(e.title, b.guest_name) title, b.starts_at, b.status
             FROM public.bookings b
             LEFT JOIN public.event_types e ON e.id=b.event_id
            WHERE b.user_id=$1 ORDER BY b.starts_at DESC LIMIT 5`,
          [userId],
        ).catch(() => ({ rows: [] }))
      : Promise.resolve({ rows: [] }),
    db.query(
      `SELECT id, subject, status, created_at FROM private.support_tickets
        WHERE user_id=$1 AND merged_into IS NULL ORDER BY created_at DESC LIMIT 8`,
      [userId],
    ),
    account
      ? db.query(
          `SELECT action, details, created_at FROM private.operation_log
            WHERE details->>'user'=$1 OR details->>'account'=$1
            ORDER BY created_at DESC LIMIT 5`,
          [userId],
        ).catch(() => ({ rows: [] }))
      : Promise.resolve({ rows: [] }),
  ]);

  const subRow = sub.rows[0];
  return {
    visitor: false,
    name: contact ? user.name : null,
    email: contact ? user.email : null,
    created_at: account ? user.created_at : null,
    account_id: account ? user.id : null,
    account_admin_href: account ? `/admin?view=accounts&account=${user.id}` : null,
    subscription: subscription
      ? subRow
        ? {
            plan: subRow.plan,
            status: billing ? subRow.status : undefined,
            seats: subRow.seats,
            catalog_version: subRow.catalog_version,
            has_billing_customer: billing ? subRow.has_customer : undefined,
            has_subscription: billing ? subRow.has_subscription : undefined,
            updated_at: subRow.updated_at,
          }
        : { plan: "none", status: billing ? "none" : undefined }
      : null,
    recent_appointments: account ? bookings.rows : [],
    previous_tickets: tickets.rows,
    recent_system_activity: account ? errors.rows : [],
  };
}

export async function supportOpsGet(request: NextRequest) {
  const current = await adminSession("support");
  const db = getPool();
  const caps = await agentCapabilities(db, current.token, current.access);
  requireCap(caps, "inbox");

  // Ticket detail must win over the dashboard default — UI requests `?ticket=` only.
  const ticketParam = request.nextUrl.searchParams.get("ticket");
  if (ticketParam) {
    const id = uuid(ticketParam);
    const found = (
      await db.query(
        `SELECT t.id, t.subject, t.status, t.category, t.subcategory, t.priority, t.tags, t.assigned_to, t.team_id,
                t.user_id, t.page, t.rating, t.resolution_notes, t.escalation_level, t.escalation_reason,
                t.created_at, t.updated_at, t.first_response_at, t.resolved_at, t.closed_at, t.reopened_at,
                t.sla_first_due_at, t.sla_resolve_due_at, t.sla_first_breached, t.sla_resolve_breached,
                t.merged_into, t.duplicate_of, (t.user_id IS NULL) visitor,
                coalesce(u.name,t.visitor_name) customer_name, coalesce(u.email,t.visitor_email) customer_email,
                u."createdAt" customer_since, a.name assignee_name, tm.name team_name
           FROM private.support_tickets t
           LEFT JOIN public."user" u ON u.id=t.user_id
           LEFT JOIN public."user" a ON a.id=t.assigned_to
           LEFT JOIN private.support_teams tm ON tm.id=t.team_id
          WHERE t.id=$1`,
        [id],
      )
    ).rows[0];
    if (!found) throw new ApiError("Ticket not found.", 404);
    const [messages, events, intel] = await Promise.all([
      db.query(
        `SELECT id::text,sender_id,staff,internal,content,created_at,
                EXISTS(SELECT 1 FROM private.support_attachments a WHERE a.message_id=m.id) attachment
           FROM private.support_messages m WHERE ticket_id=$1 ORDER BY id`,
        [id],
      ),
      db.query(
        `SELECT id::text,actor_id,kind,details,created_at FROM private.support_ticket_events
          WHERE ticket_id=$1 ORDER BY id DESC LIMIT 100`,
        [id],
      ),
      customerIntelligence(db, found.user_id, caps),
    ]);
    return {
      ticket: redactTicketContact(found, caps),
      messages: messages.rows,
      events: events.rows,
      intelligence: intel,
      sla: slaState({
        createdAt: found.created_at,
        firstResponseAt: found.first_response_at,
        resolvedAt: found.resolved_at,
        firstDueAt: found.sla_first_due_at,
        resolveDueAt: found.sla_resolve_due_at,
        firstBreached: found.sla_first_breached,
        resolveBreached: found.sla_resolve_breached,
      }),
      capabilities: caps,
      me: current.token,
    };
  }

  const view = request.nextUrl.searchParams.get("view") || "dashboard";
  if (view === "dashboard") {
    const dash = await supportOpsDashboard(current.token);
    return { ...dash, capabilities: caps, me: current.token, role: current.access.role };
  }
  if (view === "analytics") {
    requireCap(caps, "analytics");
    const from = request.nextUrl.searchParams.get("from");
    const to = request.nextUrl.searchParams.get("to");
    const fromDate = from && !Number.isNaN(Date.parse(from)) ? new Date(from) : new Date(Date.now() - 30 * 864e5);
    const toDate = to && !Number.isNaN(Date.parse(to)) ? new Date(to) : new Date();
    const { rows } = await db.query(
      `SELECT
         count(*)::int volume,
         count(*) FILTER (WHERE status IN ('resolved','closed'))::int resolved,
         count(*) FILTER (WHERE reopened_at IS NOT NULL)::int reopened,
         count(*) FILTER (WHERE escalation_level > 0 OR status='escalated')::int escalated,
         round(avg(extract(epoch FROM first_response_at-created_at)/60) FILTER (WHERE first_response_at IS NOT NULL))::int avg_first_response_minutes,
         round(avg(extract(epoch FROM resolved_at-created_at)/60) FILTER (WHERE resolved_at IS NOT NULL))::int avg_resolve_minutes,
         count(*) FILTER (WHERE sla_first_breached IS TRUE OR sla_resolve_breached IS TRUE)::int sla_breaches,
         count(*) FILTER (
           WHERE first_response_at IS NOT NULL
             AND sla_first_due_at IS NOT NULL
             AND sla_first_breached IS FALSE
             AND (
               sla_resolve_due_at IS NULL
               OR (resolved_at IS NOT NULL AND sla_resolve_breached IS FALSE)
             )
         )::int sla_met_samples,
         round(avg(rating) FILTER (WHERE rating IS NOT NULL),1)::float csat,
         count(rating)::int csat_count
       FROM private.support_tickets
       WHERE created_at >= $1 AND created_at <= $2 AND merged_into IS NULL`,
      [fromDate, toDate],
    );
    const categories = await db.query(
      `SELECT category, count(*)::int n FROM private.support_tickets
        WHERE created_at >= $1 AND created_at <= $2 AND merged_into IS NULL
        GROUP BY category ORDER BY n DESC`,
      [fromDate, toDate],
    );
    const agents = await db.query(
      `SELECT a.user_id, u.name,
              count(*) FILTER (WHERE t.assigned_to=a.user_id AND t.status NOT IN ('resolved','closed'))::int open_assigned,
              count(*) FILTER (WHERE t.assigned_to=a.user_id AND t.resolved_at >= $1 AND t.resolved_at <= $2)::int resolved
         FROM private.support_agents a
         JOIN public."user" u ON u.id=a.user_id
         LEFT JOIN private.support_tickets t ON t.assigned_to=a.user_id AND t.merged_into IS NULL
        GROUP BY a.user_id, u.name ORDER BY open_assigned DESC, u.name`,
      [fromDate, toDate],
    );
    const m = rows[0];
    return {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      metrics: {
        ...m,
        // Only report SLA compliance when we have explicit met/breach samples.
        sla_compliance_rate:
          m.sla_met_samples + m.sla_breaches > 0
            ? Math.round((m.sla_met_samples / (m.sla_met_samples + m.sla_breaches)) * 1000) / 10
            : null,
        avg_first_response_minutes: m.avg_first_response_minutes ?? null,
        avg_resolve_minutes: m.avg_resolve_minutes ?? null,
        csat: m.csat_count ? m.csat : null,
      },
      categories: categories.rows,
      agents: agents.rows,
      capabilities: caps,
    };
  }
  if (view === "kb") {
    const audience = request.nextUrl.searchParams.get("audience") || "internal";
    const q = string(request.nextUrl.searchParams.get("q") || "", "search", 100, 0);
    const { rows } = await db.query(
      `SELECT a.id,a.title,a.slug,a.audience,a.published,a.version,a.updated_at,c.name category
         FROM private.support_kb_articles a
         LEFT JOIN private.support_kb_categories c ON c.id=a.category_id
        WHERE ($1='' OR a.audience=$1 OR a.audience='both')
          AND ($2='' OR strpos(lower(a.title),lower($2))>0 OR to_tsvector('english', a.title||' '||a.body) @@ plainto_tsquery('english',$2))
        ORDER BY a.updated_at DESC LIMIT 100`,
      [audience === "all" ? "" : audience, q],
    );
    const cats = await db.query(
      "SELECT id,name,slug,audience,sort_order FROM private.support_kb_categories ORDER BY sort_order,name",
    );
    return { articles: rows, categories: cats.rows, capabilities: caps };
  }
  if (view === "config") {
    if (current.access.role !== "master_admin" && !caps.includes("sla_manage") && !caps.includes("agent_manage")) {
      throw new ApiError("Support configuration is limited to authorized administrators.", 403);
    }
    const [policies, hours, rules, teams, agents] = await Promise.all([
      listSlaPolicies(db),
      db.query("SELECT * FROM private.support_business_hours WHERE id=1"),
      db.query("SELECT * FROM private.support_escalation_rules ORDER BY after_minutes"),
      db.query("SELECT id,name,description,enabled FROM private.support_teams ORDER BY name"),
      db.query(
        `SELECT a.user_id,u.name,u.email,a.available,a.capabilities,a.team_id,a.display_title,a.email_alerts
           FROM private.support_agents a JOIN public."user" u ON u.id=a.user_id ORDER BY u.name`,
      ),
    ]);
    return {
      policies,
      businessHours: hours.rows[0] || null,
      escalationRules: rules.rows,
      teams: teams.rows,
      agents: agents.rows,
      capabilities: caps,
    };
  }

  throw new ApiError("Unknown support ops view.");
}

export async function supportOpsPost(request: NextRequest) {
  sameOrigin(request);
  const current = await adminSession("support");
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    const caps = await agentCapabilities(db, current.token, current.access);
    const input = await body(request);

    if (input.action === "escalate") {
      requireCap(caps, "escalate");
      const id = uuid(input.ticket);
      const reason = string(input.reason || "", "escalation reason", 500, 0);
      const priority = (supportPriorities as readonly string[]).includes(String(input.priority))
        ? String(input.priority)
        : "urgent";
      const updated = await db.query(
        `UPDATE private.support_tickets
            SET status='escalated', priority=$2, escalation_level=least(escalation_level+1,5),
                escalated_at=coalesce(escalated_at,now()), escalated_by=$3, escalation_reason=$4, updated_at=now()
          WHERE id=$1 AND merged_into IS NULL
          RETURNING id, subject, escalation_level, created_at`,
        [id, priority, current.token, reason],
      );
      if (!updated.rowCount) throw new ApiError("Ticket not found.", 404);
      const level = Number(updated.rows[0].escalation_level || 1);
      await applySlaDeadlines(db, id, priority, new Date(updated.rows[0].created_at));
      await recordEvent(db, id, current.token, "escalated", { reason, priority, level });
      const recipients = await staffRecipients(db, ["support"]);
      const pushJobs: Array<{ userId: string; title: string; body: string; url: string }> = [];
      for (const userId of recipients) {
        const alert = await createPlatformAlert(db, {
          recipientUserId: userId,
          kind: "support_escalated",
          title: `Escalated: ${updated.rows[0].subject}`,
          body: reason || "A support ticket was escalated.",
          href: `/admin/support-ops?ticket=${id}`,
          // Dedupe per escalation level so re-escalations still notify once each.
          dedupeKey: `support:escalated:${id}:L${level}:${userId}`,
          push: false,
        });
        if (alert.created) {
          pushJobs.push({
            userId,
            title: `Escalated: ${updated.rows[0].subject}`,
            body: reason || "A support ticket was escalated.",
            url: `/admin/support-ops?ticket=${id}`,
          });
        }
      }
      await db.query("COMMIT");
      const { deliverWebPushToUser } = await import("./web-push");
      for (const job of pushJobs) {
        void deliverWebPushToUser(getPool(), job.userId, {
          title: job.title,
          body: job.body,
          url: job.url,
          tag: `support-escalated-${id}-L${level}`,
        }).catch(() => null);
      }
      return { ok: true };
    }

    if (input.action === "merge") {
      requireCap(caps, "merge");
      const source = uuid(input.source);
      const target = uuid(input.target);
      if (source === target) throw new ApiError("Choose two different tickets.");
      const rows = await db.query(
        `SELECT id, subject, user_id, visitor_email, merged_into
           FROM private.support_tickets WHERE id=ANY($1::uuid[]) FOR UPDATE`,
        [[source, target]],
      );
      if (rows.rowCount !== 2) throw new ApiError("Both tickets must exist.", 404);
      const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r]));
      const src = byId[source];
      const tgt = byId[target];
      if (src.merged_into || tgt.merged_into) {
        throw new ApiError("Cannot merge tickets that were already merged.", 409);
      }
      // Visitor emails are self-asserted and unverified — matching addresses alone
      // must not authorize a merge (that would let a spoofed-email token reach the
      // survivor). Only signed-in account ownership is a shared verified identity.
      const sameUser = src.user_id && tgt.user_id && src.user_id === tgt.user_id;
      if (!sameUser) {
        throw new ApiError("Tickets can only be merged when they belong to the same signed-in customer.", 400);
      }
      await db.query(
        "UPDATE private.support_messages SET ticket_id=$2 WHERE ticket_id=$1",
        [source, target],
      );
      await db.query(
        `UPDATE private.support_tickets
            SET merged_into=$2, status='closed', closed_at=coalesce(closed_at,now()), updated_at=now()
          WHERE id=$1 AND merged_into IS NULL`,
        [source, target],
      );
      await recordEvent(db, source, current.token, "merged_into", { target });
      await recordEvent(db, target, current.token, "merged_from", { source });
      await db.query("COMMIT");
      return { ok: true };
    }

    if (input.action === "duplicate") {
      requireCap(caps, "merge");
      const id = uuid(input.ticket);
      const duplicateOf = uuid(input.duplicate_of);
      await db.query(
        `UPDATE private.support_tickets
            SET duplicate_of=$2, status='closed', closed_at=coalesce(closed_at,now()), updated_at=now()
          WHERE id=$1`,
        [id, duplicateOf],
      );
      await recordEvent(db, id, current.token, "marked_duplicate", { duplicateOf });
      await db.query("COMMIT");
      return { ok: true };
    }

    if (input.action === "create-staff-ticket") {
      requireCap(caps, "reply");
      const userId = input.user_id ? uuid(input.user_id) : null;
      const subject = string(input.subject, "subject", 150);
      const category = isSupportCategory(input.category) ? input.category : "other";
      const content = string(input.content, "message", 4000);
      const reference = uuid(input.reference);
      const created = await db.query(
        `INSERT INTO private.support_tickets(user_id,subject,category,status,assigned_to,last_staff_at)
         VALUES($1,$2,$3,'open',$4,now()) RETURNING id, created_at`,
        [userId, subject, category, current.token],
      );
      const id = created.rows[0].id as string;
      await db.query(
        `INSERT INTO private.support_messages(ticket_id,sender_id,staff,internal,content,reference)
         VALUES($1,$2,true,false,$3,$4)`,
        [id, current.token, content, reference],
      );
      await applySlaDeadlines(db, id, "normal", new Date(created.rows[0].created_at));
      await recordEvent(db, id, current.token, "created_by_staff", { subject, category });
      await db.query("COMMIT");
      return { ok: true, id };
    }

    if (input.action === "set-tags") {
      requireCap(caps, "assign");
      const id = uuid(input.ticket);
      const tags = Array.isArray(input.tags)
        ? input.tags.map((t: unknown) => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 20)
        : [];
      await db.query("UPDATE private.support_tickets SET tags=$2::text[], updated_at=now() WHERE id=$1", [
        id,
        tags,
      ]);
      await recordEvent(db, id, current.token, "tags_updated", { tags });
      await db.query("COMMIT");
      return { ok: true };
    }

    if (input.action === "save-agent-capabilities") {
      requireCap(caps, "agent_manage");
      if (current.access.role !== "master_admin" && !caps.includes("agent_manage")) {
        throw new ApiError("Only authorized administrators can manage agent capabilities.", 403);
      }
      const userId = uuid(input.user_id);
      if (!canAccess(await adminAccess(userId), "support")) {
        throw new ApiError("That user is not on the support team.", 400);
      }
      const next = Array.isArray(input.capabilities)
        ? input.capabilities.filter(isSupportCapability)
        : defaultSupportCapabilities;
      // Impersonation is never granted through this UI without master admin.
      const filtered =
        current.access.role === "master_admin" ? next : next.filter((c) => c !== "impersonate");
      await db.query(
        `INSERT INTO private.support_agents(user_id,capabilities)
         VALUES($1,$2::text[])
         ON CONFLICT (user_id) DO UPDATE SET capabilities=$2::text[]`,
        [userId, filtered],
      );
      await db.query(
        "INSERT INTO private.operation_log(actor_id,action,details) VALUES($1,'support_agent_capabilities',$2)",
        [current.token, JSON.stringify({ user: userId, capabilities: filtered })],
      );
      await db.query("COMMIT");
      return { ok: true };
    }

    if (input.action === "kb-save") {
      requireCap(caps, "kb_manage");
      const title = string(input.title, "title", 160);
      const bodyText = string(input.body, "body", 50000);
      const audience = ["internal", "customer", "both"].includes(String(input.audience))
        ? String(input.audience)
        : "internal";
      const slug =
        string(input.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), "slug", 160) ||
        `article-${Date.now()}`;
      const published = input.published === true;
      if (input.id) {
        const id = uuid(input.id);
        const prior = (await db.query("SELECT version,title,body FROM private.support_kb_articles WHERE id=$1 FOR UPDATE", [id])).rows[0];
        if (!prior) throw new ApiError("Article not found.", 404);
        const version = Number(prior.version) + 1;
        await db.query(
          `UPDATE private.support_kb_articles
              SET title=$2, body=$3, audience=$4, slug=$5, published=$6, version=$7, updated_by=$8, updated_at=now(),
                  published_at=CASE WHEN $6 THEN coalesce(published_at,now()) ELSE published_at END
            WHERE id=$1`,
          [id, title, bodyText, audience, slug, published, version, current.token],
        );
        await db.query(
          "INSERT INTO private.support_kb_versions(article_id,version,title,body,editor_id) VALUES($1,$2,$3,$4,$5)",
          [id, version, title, bodyText, current.token],
        );
        await db.query("COMMIT");
        return { ok: true, id, version };
      }
      const created = await db.query(
        `INSERT INTO private.support_kb_articles(title,slug,body,audience,published,author_id,updated_by,published_at)
         VALUES($1,$2,$3,$4,$5,$6,$6,CASE WHEN $5 THEN now() ELSE NULL END) RETURNING id, version`,
        [title, slug, bodyText, audience, published, current.token],
      );
      await db.query(
        "INSERT INTO private.support_kb_versions(article_id,version,title,body,editor_id) VALUES($1,1,$2,$3,$4)",
        [created.rows[0].id, title, bodyText, current.token],
      );
      await db.query("COMMIT");
      return { ok: true, id: created.rows[0].id, version: 1 };
    }

    if (input.action === "update-sla-policy") {
      requireCap(caps, "sla_manage");
      const id = uuid(input.id);
      const first = input.first_response_minutes == null || input.first_response_minutes === ""
        ? null
        : Number(input.first_response_minutes);
      const resolve = input.resolve_minutes == null || input.resolve_minutes === ""
        ? null
        : Number(input.resolve_minutes);
      if (first != null && (!Number.isInteger(first) || first <= 0)) throw new ApiError("Invalid first-response target.");
      if (resolve != null && (!Number.isInteger(resolve) || resolve <= 0)) throw new ApiError("Invalid resolution target.");
      await db.query(
        `UPDATE private.support_sla_policies
            SET first_response_minutes=$2, resolve_minutes=$3, business_hours_only=$4, enabled=$5
          WHERE id=$1`,
        [id, first, resolve, input.business_hours_only === true, input.enabled !== false],
      );
      await db.query("COMMIT");
      return { ok: true };
    }

    throw new ApiError("Unknown support ops action.");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
