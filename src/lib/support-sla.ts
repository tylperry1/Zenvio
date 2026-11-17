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

type BusinessHoursRow = {
  timezone: string;
  monday: string;
  tuesday: string;
  wednesday: string;
  thursday: string;
  friday: string;
  saturday: string;
  sunday: string;
};

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

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

function parseWindow(raw: string): { start: number; end: number } | null {
  if (!raw || raw === "off") return null;
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  if (!(end > start)) return null;
  return { start, end };
}

function zonedParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );
  return {
    weekday: WEEKDAY[parts.weekday] ?? 0,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** Convert a wall-clock time in `timeZone` to a UTC Date (iterative offset correction). */
function zonedWallToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
) {
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 4; i++) {
    const local = zonedParts(new Date(guess), timeZone);
    const asUtcMs = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0);
    const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
    guess += wanted - asUtcMs;
  }
  return new Date(guess);
}

function addLocalDays(year: number, month: number, day: number, add: number) {
  const dt = new Date(Date.UTC(year, month - 1, day + add));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

/**
 * Advance `start` by `minutes` of configured business hours.
 * Falls back to wall-clock minutes when hours are missing.
 */
export function addBusinessMinutes(start: Date, minutes: number, hours: BusinessHoursRow): Date {
  if (!Number.isFinite(minutes) || minutes <= 0) return new Date(start.getTime());
  const tz = hours.timezone || "America/New_York";
  let remaining = Math.floor(minutes);
  let cursor = new Date(start.getTime());

  for (let guard = 0; guard < 20000 && remaining > 0; guard++) {
    const local = zonedParts(cursor, tz);
    const dayKey = DAY_KEYS[local.weekday];
    const window = parseWindow(String(hours[dayKey] || "off"));
    if (!window) {
      const next = addLocalDays(local.year, local.month, local.day, 1);
      cursor = zonedWallToUtc(next.year, next.month, next.day, 0, 0, tz);
      continue;
    }
    const minsNow = local.hour * 60 + local.minute;
    if (minsNow >= window.end) {
      const next = addLocalDays(local.year, local.month, local.day, 1);
      cursor = zonedWallToUtc(next.year, next.month, next.day, 0, 0, tz);
      continue;
    }
    if (minsNow < window.start) {
      cursor = zonedWallToUtc(
        local.year,
        local.month,
        local.day,
        Math.floor(window.start / 60),
        window.start % 60,
        tz,
      );
      continue;
    }
    const available = window.end - minsNow;
    if (remaining <= available) {
      cursor = new Date(cursor.getTime() + remaining * 60_000);
      remaining = 0;
    } else {
      remaining -= available;
      const next = addLocalDays(local.year, local.month, local.day, 1);
      cursor = zonedWallToUtc(next.year, next.month, next.day, 0, 0, tz);
    }
  }
  return cursor;
}

export async function applySlaDeadlines(db: DB, ticketId: string, priority: string, createdAt?: Date) {
  const policy = (
    await db.query(
      `SELECT first_response_minutes, resolve_minutes, business_hours_only FROM private.support_sla_policies
        WHERE enabled AND priority=$1 LIMIT 1`,
      [priority],
    )
  ).rows[0] as
    | {
        first_response_minutes: number | null;
        resolve_minutes: number | null;
        business_hours_only: boolean;
      }
    | undefined;

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
  let firstDue: Date | null = null;
  let resolveDue: Date | null = null;

  if (policy.business_hours_only) {
    const hours = (
      await db.query("SELECT timezone,monday,tuesday,wednesday,thursday,friday,saturday,sunday FROM private.support_business_hours WHERE id=1")
    ).rows[0] as BusinessHoursRow | undefined;
    if (hours) {
      if (policy.first_response_minutes != null) {
        firstDue = addBusinessMinutes(base, policy.first_response_minutes, hours);
      }
      if (policy.resolve_minutes != null) {
        resolveDue = addBusinessMinutes(base, policy.resolve_minutes, hours);
      }
    } else {
      if (policy.first_response_minutes != null) {
        firstDue = new Date(base.getTime() + policy.first_response_minutes * 60_000);
      }
      if (policy.resolve_minutes != null) {
        resolveDue = new Date(base.getTime() + policy.resolve_minutes * 60_000);
      }
    }
  } else {
    if (policy.first_response_minutes != null) {
      firstDue = new Date(base.getTime() + policy.first_response_minutes * 60_000);
    }
    if (policy.resolve_minutes != null) {
      resolveDue = new Date(base.getTime() + policy.resolve_minutes * 60_000);
    }
  }

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

/**
 * Refresh breach flags for every open ticket with SLA dues.
 * Does not invent compliance when dues are null. No "newest N" cap —
 * older tickets must not stay unflagged forever.
 */
export async function refreshSlaBreaches(db: DB = getPool()) {
  await db.query(
    `UPDATE private.support_tickets t
        SET sla_first_breached = v.first_breached,
            sla_resolve_breached = v.resolve_breached
       FROM (
         SELECT id,
                CASE
                  WHEN sla_first_due_at IS NULL THEN NULL
                  WHEN first_response_at IS NOT NULL THEN first_response_at > sla_first_due_at
                  ELSE now() > sla_first_due_at
                END AS first_breached,
                CASE
                  WHEN sla_resolve_due_at IS NULL THEN NULL
                  WHEN resolved_at IS NOT NULL THEN resolved_at > sla_resolve_due_at
                  WHEN status IN ('resolved','closed') THEN NULL
                  ELSE now() > sla_resolve_due_at
                END AS resolve_breached
           FROM private.support_tickets
          WHERE merged_into IS NULL
            AND status NOT IN ('resolved','closed')
            AND (sla_first_due_at IS NOT NULL OR sla_resolve_due_at IS NOT NULL)
       ) v
      WHERE t.id = v.id
        AND (t.sla_first_breached, t.sla_resolve_breached) IS DISTINCT FROM (v.first_breached, v.resolve_breached)`,
  );
}
