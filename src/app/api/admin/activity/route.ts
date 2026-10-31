import { NextRequest } from "next/server";
import { adminSession, canAccess } from "@/lib/admin";
import { getPool } from "@/lib/db";
import { ApiError, failure, integer, string, uuid } from "@/lib/server";

export const dynamic = "force-dynamic";
const PAGE = 25;
const statuses = ["all", "active", "inactive", "new", "paying", "unverified", "staff"] as const;
type Status = (typeof statuses)[number];

// "Last active" is the most recent session activity; Better Auth refreshes
// session.updatedAt at most daily, so this is accurate to roughly one day.
const lastActive = `(SELECT max(greatest(s."createdAt",s."updatedAt")) FROM public.session s WHERE s."userId"=u.id)`;
const paying = `EXISTS(SELECT 1 FROM private.subscriptions x WHERE x.user_id=u.id AND x.status IN ('active','trialing','past_due') AND x.subscription_id IS NOT NULL)`;
const filters: Record<Status, string> = {
  all: "true",
  active: `${lastActive} >= now()-interval '30 days'`,
  inactive: `coalesce(${lastActive},'epoch') < now()-interval '30 days'`,
  new: `u."createdAt" >= now()-interval '30 days'`,
  paying,
  unverified: `NOT u."emailVerified"`,
  staff: `(EXISTS(SELECT 1 FROM private.platform_roles r WHERE r.user_id=u.id) OR EXISTS(SELECT 1 FROM private.staff_members m WHERE m.user_id=u.id))`,
};

function csvCell(v: unknown) {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralize spreadsheet formulas in user-controlled values.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replaceAll('"', '""')}"`;
}

export async function GET(request: NextRequest) {
  try {
    const { access } = await adminSession(["accounts", "audit"]);
    const q = request.nextUrl.searchParams;
    const view = q.get("view") || "summary";
    const db = getPool();

    if (view === "log") {
      if (!canAccess(access, "audit")) throw new ApiError("This area is reserved for the platform administrator.", 403);
      const page = integer(Number(q.get("page") || 0), "page", 0, 100000);
      const search = string(q.get("search") || "", "search", 100, 0).toLowerCase();
      const action = string(q.get("action") || "", "action", 60, 0);
      // Configuration changes and account administration in one stream.
      const base = `SELECT 'operation' source,l.id,l.action,l.details,l.created_at,actor.email actor,NULL::text account
                      FROM private.operation_log l LEFT JOIN public."user" actor ON actor.id=l.actor_id
                    UNION ALL
                    SELECT 'admin',a.id,a.action,a.details,a.created_at,actor.email,acc.email
                      FROM private.admin_audit_log a LEFT JOIN public."user" actor ON actor.id=a.actor_id LEFT JOIN public."user" acc ON acc.id=a.account_id`;
      const where = `WHERE ($1='' OR action=$1) AND ($2='' OR position($2 in lower(action||' '||coalesce(actor,'')||' '||coalesce(account,'')||' '||details::text))>0)`;
      const [rows, total, actions] = await Promise.all([
        db.query(`SELECT * FROM (${base}) e ${where} ORDER BY created_at DESC,id LIMIT ${PAGE} OFFSET $3`, [action, search, page * PAGE]),
        db.query(`SELECT count(*)::int total FROM (${base}) e ${where}`, [action, search]),
        db.query(`SELECT action,count(*)::int count FROM (${base}) e GROUP BY action ORDER BY count DESC,action`),
      ]);
      return Response.json(
        { entries: rows.rows, total: total.rows[0].total, page, pageSize: PAGE, actions: actions.rows },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (!canAccess(access, "accounts")) throw new ApiError("This area is reserved for the platform administrator.", 403);

    if (view === "user") {
      const id = uuid(q.get("id"));
      const user = (
        await db.query(
          `SELECT u.id,u.name,u.email,u."emailVerified" verified,u."createdAt" created_at,p.slug,p.timezone,
                  ${lastActive} last_active,private.effective_plan(u.id) plan,
                  s.plan subscription_plan,s.status subscription_status,s.current_period_end,s.cancel_at_period_end,s.seats,
                  (SELECT count(*)::int FROM public.session x WHERE x."userId"=u.id AND x."expiresAt">now()) open_sessions,
                  (SELECT count(*)::int FROM public.bookings b WHERE b.user_id=u.id) bookings,
                  (SELECT count(*)::int FROM public.event_types e WHERE e.user_id=u.id AND e.deleted_at IS NULL) event_types,
                  (SELECT count(*)::int FROM public.contacts c WHERE c.user_id=u.id) contacts,
                  EXISTS(SELECT 1 FROM private.platform_roles r WHERE r.user_id=u.id) master,
                  EXISTS(SELECT 1 FROM private.staff_members m WHERE m.user_id=u.id) staff
             FROM public."user" u LEFT JOIN public.profiles p ON p.id=u.id
             LEFT JOIN private.subscriptions s ON s.user_id=u.id WHERE u.id=$1`,
          [id],
        )
      ).rows[0];
      if (!user) throw new ApiError("User not found.", 404);
      const sessions = await db.query(
        `SELECT "createdAt" created_at,"updatedAt" updated_at,"expiresAt" expires_at,"userAgent" user_agent
           FROM public.session WHERE "userId"=$1 AND "expiresAt">now() ORDER BY "updatedAt" DESC LIMIT 10`,
        [id],
      );
      const history = await db.query(
        `SELECT action,created_at FROM private.admin_audit_log WHERE account_id=$1
         UNION ALL SELECT action,created_at FROM private.operation_log WHERE details->>'userId'=$1::text
         ORDER BY created_at DESC LIMIT 15`,
        [id],
      );
      return Response.json({ user, sessions: sessions.rows, history: history.rows }, { headers: { "Cache-Control": "no-store" } });
    }

    const status = (statuses as readonly string[]).includes(q.get("status") || "") ? (q.get("status") as Status) : "all";
    const search = string(q.get("search") || "", "search", 100, 0).toLowerCase();
    const where = `WHERE ${filters[status]} AND ($1='' OR position($1 in lower(u.name||' '||u.email))>0)`;
    const select = `SELECT u.id,u.name,u.email,u."emailVerified" verified,u."createdAt" created_at,${lastActive} last_active,
                           private.effective_plan(u.id) plan,s.status subscription_status,
                           EXISTS(SELECT 1 FROM private.platform_roles r WHERE r.user_id=u.id) master,
                           EXISTS(SELECT 1 FROM private.staff_members m WHERE m.user_id=u.id) staff
                      FROM public."user" u LEFT JOIN private.subscriptions s ON s.user_id=u.id ${where}
                     ORDER BY u."createdAt" DESC,u.id`;

    if (view === "csv") {
      const { rows } = await db.query(`${select} LIMIT 5000`, [search]);
      const header = ["Name", "Email", "Verified", "Plan", "Subscription status", "Signed up", "Last active", "Role"];
      const lines = rows.map((r) =>
        [r.name, r.email, r.verified ? "yes" : "no", r.plan, r.subscription_status || "", r.created_at?.toISOString(), r.last_active?.toISOString() || "", r.master ? "master admin" : r.staff ? "staff" : "member"]
          .map(csvCell)
          .join(","),
      );
      return new Response([header.map(csvCell).join(","), ...lines].join("\r\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="zenvio-users-${status}-${new Date().toISOString().slice(0, 10)}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const page = integer(Number(q.get("page") || 0), "page", 0, 100000);
    const [users, total, kpis, signups, activity, plans] = await Promise.all([
      db.query(`${select} LIMIT ${PAGE} OFFSET $2`, [search, page * PAGE]),
      db.query(`SELECT count(*)::int total FROM public."user" u ${where}`, [search]),
      db.query(
        `SELECT count(*)::int total,
                count(*) FILTER (WHERE ${filters.active})::int active,
                count(*) FILTER (WHERE u."createdAt">=now()-interval '30 days')::int new_30d,
                count(*) FILTER (WHERE u."createdAt">=now()-interval '60 days' AND u."createdAt"<now()-interval '30 days')::int new_prev_30d,
                count(*) FILTER (WHERE ${paying})::int paying,
                count(*) FILTER (WHERE NOT u."emailVerified")::int unverified
           FROM public."user" u`,
      ),
      db.query(
        `SELECT d::date AS day,(SELECT count(*)::int FROM public."user" u WHERE u."createdAt">=d AND u."createdAt"<d+interval '1 day') value
           FROM generate_series(date_trunc('day',now() AT TIME ZONE 'UTC')-interval '29 days',date_trunc('day',now() AT TIME ZONE 'UTC'),interval '1 day') d`,
      ),
      // Distinct users with a session started or refreshed that UTC day.
      db.query(
        `SELECT d::date AS day,(SELECT count(DISTINCT s."userId")::int FROM public.session s
                  WHERE (s."createdAt">=d AND s."createdAt"<d+interval '1 day') OR (s."updatedAt">=d AND s."updatedAt"<d+interval '1 day')) value
           FROM generate_series(date_trunc('day',now() AT TIME ZONE 'UTC')-interval '29 days',date_trunc('day',now() AT TIME ZONE 'UTC'),interval '1 day') d`,
      ),
      db.query(`SELECT private.effective_plan(u.id) plan,count(*)::int count FROM public."user" u GROUP BY 1 ORDER BY 2 DESC`),
    ]);
    return Response.json(
      {
        kpis: kpis.rows[0],
        signups: signups.rows,
        activity: activity.rows,
        plans: plans.rows,
        users: users.rows,
        total: total.rows[0].total,
        page,
        pageSize: PAGE,
        canSeeLog: canAccess(access, "audit"),
        isMaster: access.role === "master_admin",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
