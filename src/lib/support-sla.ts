import type { PoolClient } from "pg";
import { getPool } from "./db";

type DB = Pick<PoolClient, "query">;

export type SlaPolicy = {
  id: string;
  name: string;
  priority: string;
  first_response_minutes: number | null;
  resolve_minutes: number | null;
  business_hours_only: boolean;
  enabled: boolean;
};

/** Never claim SLA met/breached when the required timestamps or policy targets are missing. */
export function slaState(input: {
  createdAt: string | Date | null;
  firstResponseAt: string | Date | null;
  resolvedAt: string | Date | null;
  firstDueAt: string | Date | null;
  resolveDueAt: string | Date | null;
  firstBreached: boolean | null;
  resolveBreached: boolean | null;
  now?: Date;
}) {
  const now = input.now || new Date();
  const firstDue = input.firstDueAt ? new Date(input.firstDueAt) : null;
  const resolveDue = input.resolveDueAt ? new Date(input.resolveDueAt) : null;
  const firstResponse = input.firstResponseAt ? new Date(input.firstResponseAt) : null;
  const resolved = input.resolvedAt ? new Date(input.resolvedAt) : null;

  const first =
    !firstDue
      ? { state: "unknown" as const, label: "First response SLA not configured", dueAt: null }
      : firstResponse
        ? input.firstBreached === true || firstResponse.getTime() > firstDue.getTime()
          ? { state: "breached" as const, label: "First response breached", dueAt: firstDue.toISOString() }
          : input.firstBreached === false || firstResponse.getTime() <= firstDue.getTime()
            ? { state: "met" as const, label: "First response met", dueAt: firstDue.toISOString() }
            : { state: "unknown" as const, label: "First response SLA incomplete", dueAt: firstDue.toISOString() }
        : now.getTime() > firstDue.getTime()
          ? { state: "breached" as const, label: "First response overdue", dueAt: firstDue.toISOString() }
          : { state: "pending" as const, label: "First response due", dueAt: firstDue.toISOString() };

  const resolve =
    !resolveDue
      ? { state: "unknown" as const, label: "Resolution SLA not configured", dueAt: null }
      : resolved
        ? input.resolveBreached === true || resolved.getTime() > resolveDue.getTime()
          ? { state: "breached" as const, label: "Resolution breached", dueAt: resolveDue.toISOString() }
          : { state: "met" as const, label: "Resolution met", dueAt: resolveDue.toISOString() }
        : now.getTime() > resolveDue.getTime()
          ? { state: "breached" as const, label: "Resolution overdue", dueAt: resolveDue.toISOString() }
          : { state: "pending" as const, label: "Resolution due", dueAt: resolveDue.toISOString() };

  return { first, resolve };
}

export async function listSlaPolicies(db: DB = getPool()) {
  const { rows } = await db.query(
    `SELECT id,name,priority,first_response_minutes,resolve_minutes,business_hours_only,enabled
       FROM private.support_sla_policies ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END`,
  );
  return rows as SlaPolicy[];
}

export async function applySlaDeadlines(db: DB, ticketId: string, priority: string, createdAt?: Date) {
  const policy = (
    await db.query(
      `SELECT first_response_minutes, resolve_minutes FROM private.support_sla_policies
        WHERE enabled AND priority=$1 LIMIT 1`,
      [priority],
    )
  ).rows[0] as { first_response_minutes: number | null; resolve_minutes: number | null } | undefined;

  if (!policy) {
    await db.query(
      `UPDATE private.support_tickets
          SET sla_first_due_at=NULL, sla_resolve_due_at=NULL,
              sla_first_breached=NULL, sla_resolve_breached=NULL
        WHERE id=$1`,
      [ticketId],
    );
    return null;
  }

  const base = createdAt || new Date();
  const firstDue =
    policy.first_response_minutes != null
      ? new Date(base.getTime() + policy.first_response_minutes * 60_000)
      : null;
  const resolveDue =
    policy.resolve_minutes != null ? new Date(base.getTime() + policy.resolve_minutes * 60_000) : null;

  await db.query(
    `UPDATE private.support_tickets
        SET sla_first_due_at=$2, sla_resolve_due_at=$3,
            sla_first_breached=CASE WHEN $2::timestamptz IS NULL THEN NULL ELSE sla_first_breached END,
            sla_resolve_breached=CASE WHEN $3::timestamptz IS NULL THEN NULL ELSE sla_resolve_breached END
      WHERE id=$1`,
    [ticketId, firstDue, resolveDue],
  );
  return { firstDue, resolveDue, policy };
}

/** Refresh breach flags from wall-clock. Does not invent compliance when dues are null. */
export async function refreshSlaBreaches(db: DB = getPool(), limit = 200) {
  await db.query(
    `UPDATE private.support_tickets
        SET sla_first_breached = CASE
              WHEN sla_first_due_at IS NULL THEN NULL
              WHEN first_response_at IS NOT NULL THEN first_response_at > sla_first_due_at
              ELSE now() > sla_first_due_at
            END,
            sla_resolve_breached = CASE
              WHEN sla_resolve_due_at IS NULL THEN NULL
              WHEN resolved_at IS NOT NULL THEN resolved_at > sla_resolve_due_at
              WHEN status IN ('resolved','closed') THEN NULL
              ELSE now() > sla_resolve_due_at
            END
      WHERE status NOT IN ('closed')
        AND id IN (
          SELECT id FROM private.support_tickets
           WHERE merged_into IS NULL
           ORDER BY updated_at DESC LIMIT $1
        )`,
    [limit],
  );
}
