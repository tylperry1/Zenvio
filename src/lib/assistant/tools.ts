import type Anthropic from "@anthropic-ai/sdk";
import { getPool } from "../db";
import { ApiError } from "../server";
import { zonedDate, inZone } from "../scheduling.mjs";
import { googleBusyForHost } from "../google-calendar";
import { bookingUrl, businessName, contactPhone, ensureContactThread, sendThreadMessage } from "../messaging";
import { smsReadiness } from "../sms";
import { drainDeliveries } from "../lifecycle";
import { afterBookingChange, hostCancelBooking, hostRescheduleBooking } from "../booking-actions";

// Typed tool registry for the Zenvio assistant.
//
// Every tool receives the signed-in user's context from the server, never from the model, and
// every query is scoped to that user. Read tools return only the fields an answer needs. Action
// tools never run when the model calls them: `prepare` validates and authorizes the request and
// returns a preview, the user approves it in the UI, and only then does `execute` run, after
// authorizing again. There is no generic query tool.

export type ToolContext = { userId: string; userName: string; timezone: string };
export type Preview = {
  title: string;
  summary: string;
  details: { label: string; value: string }[];
  confirmLabel: string;
  danger?: boolean;
  warning?: string;
};
export type ActionOutcome = { message: string; data?: Record<string, unknown> };
type Schema = Anthropic.Tool["input_schema"];
type Base<I> = {
  name: string;
  label: string;
  description: string;
  input_schema: Schema;
  parse: (input: unknown) => I;
};
export type ReadTool<I = any> = Base<I> & { kind: "read"; run: (ctx: ToolContext, input: I) => Promise<unknown> };
export type ActionTool<I = any> = Base<I> & {
  kind: "action";
  prepare: (ctx: ToolContext, input: I) => Promise<Preview>;
  execute: (ctx: ToolContext, input: I) => Promise<ActionOutcome>;
};
export type AssistantTool = ReadTool | ActionTool;

export class ToolInputError extends Error {}

// ---- validation helpers (model input is untrusted) ---------------------------------------
function object(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ToolInputError("Input must be an object.");
  return input as Record<string, unknown>;
}
function text(v: unknown, name: string, max: number, required = true) {
  if (v === undefined || v === null || v === "") {
    if (required) throw new ToolInputError(`${name} is required.`);
    return "";
  }
  if (typeof v !== "string" || v.length > max) throw new ToolInputError(`${name} must be text up to ${max} characters.`);
  return v.trim();
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function id(v: unknown, name: string) {
  if (typeof v !== "string" || !UUID.test(v)) throw new ToolInputError(`${name} must be an id returned by another tool.`);
  return v.toLowerCase();
}
function oneOf<T extends string>(v: unknown, name: string, options: readonly T[], fallback?: T): T {
  if (v === undefined && fallback) return fallback;
  if (typeof v !== "string" || !options.includes(v as T)) throw new ToolInputError(`${name} must be one of ${options.join(", ")}.`);
  return v as T;
}
function int(v: unknown, name: string, min: number, max: number, fallback: number) {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max)
    throw new ToolInputError(`${name} must be a whole number from ${min} to ${max}.`);
  return v;
}
function day(v: unknown, name: string, required = false) {
  if (v === undefined || v === null || v === "") {
    if (required) throw new ToolInputError(`${name} is required.`);
    return "";
  }
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)))
    throw new ToolInputError(`${name} must be a date like 2026-11-03.`);
  return v;
}
function instant(v: unknown, name: string) {
  if (typeof v !== "string" || v.length > 40 || !Number.isFinite(Date.parse(v)))
    throw new ToolInputError(`${name} must be an ISO 8601 date-time with offset.`);
  return new Date(v).toISOString();
}

// Customer-written text is wrapped so the model treats it as data. Markers inside the text are
// neutralized so content cannot close the wrapper and pose as instructions.
export function untrusted(value: unknown, max = 600) {
  if (typeof value !== "string" || !value.trim()) return "";
  const clean = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f‪-‮⁦-⁩]/g, "")
    .replace(/<\/?\s*customer_content[^>]*>/gi, "")
    .slice(0, max);
  return `<customer_content>${clean}</customer_content>`;
}

function local(ctx: ToolContext, value: string | Date) {
  return new Date(value).toLocaleString("en-US", {
    timeZone: ctx.timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

async function ownedContact(ctx: ToolContext, contactId: string) {
  const c = (
    await getPool().query("SELECT id,name,email,company,notes FROM public.contacts WHERE id=$1 AND user_id=$2", [
      contactId,
      ctx.userId,
    ])
  ).rows[0];
  if (!c) throw new ApiError("That client isn’t in your workspace.", 404);
  return c as { id: string; name: string; email: string; company: string; notes: string };
}
async function ownedBooking(ctx: ToolContext, bookingId: string) {
  const b = (
    await getPool().query(
      `SELECT b.id,b.guest_name,b.guest_email,b.starts_at,b.ends_at,b.status,e.title FROM public.bookings b JOIN public.event_types e ON e.id=b.event_id WHERE b.id=$1 AND b.user_id=$2`,
      [bookingId, ctx.userId],
    )
  ).rows[0];
  if (!b) throw new ApiError("That appointment isn’t in your workspace.", 404);
  return b;
}

// ---- read tools ---------------------------------------------------------------------------
const listAppointments: ReadTool<{ from: string; to: string; status: string; limit: number }> = {
  kind: "read",
  name: "list_appointments",
  label: "Checked appointments",
  description:
    "List the user's appointments. Dates are calendar days in the user's timezone; `to` is inclusive. Use status 'upcoming' for future confirmed appointments, 'past' for completed ones, 'cancelled' for cancellations, or 'any'.",
  input_schema: {
    type: "object",
    properties: {
      from: { type: "string", description: "First day, YYYY-MM-DD. Defaults to today." },
      to: { type: "string", description: "Last day, YYYY-MM-DD." },
      status: { type: "string", enum: ["upcoming", "past", "cancelled", "any"] },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
  },
  parse(raw) {
    const v = object(raw);
    return {
      from: day(v.from, "from"),
      to: day(v.to, "to"),
      status: oneOf(v.status, "status", ["upcoming", "past", "cancelled", "any"] as const, "any"),
      limit: int(v.limit, "limit", 1, 50, 25),
    };
  },
  async run(ctx, input) {
    const where = ["b.user_id=$1"],
      values: unknown[] = [ctx.userId];
    if (input.from) {
      values.push(zonedDate(input.from, "00:00", ctx.timezone)?.toISOString());
      where.push(`b.starts_at>=$${values.length}`);
    }
    if (input.to) {
      const end = new Date(Date.parse(input.to) + 86400000).toISOString().slice(0, 10);
      values.push(zonedDate(end, "00:00", ctx.timezone)?.toISOString());
      where.push(`b.starts_at<$${values.length}`);
    }
    if (input.status === "upcoming") where.push("b.status='confirmed' AND b.ends_at>=now()");
    if (input.status === "past") where.push("b.status='confirmed' AND b.ends_at<now()");
    if (input.status === "cancelled") where.push("b.status='cancelled'");
    const { rows } = await getPool().query(
      `SELECT b.id,b.guest_name,b.guest_email,b.starts_at,b.ends_at,b.status,b.notes,b.contact_id,e.title,e.location
         FROM public.bookings b JOIN public.event_types e ON e.id=b.event_id
        WHERE ${where.join(" AND ")} ORDER BY b.starts_at ${input.status === "past" ? "DESC" : "ASC"} LIMIT ${input.limit}`,
      values,
    );
    return {
      count: rows.length,
      appointments: rows.map((b) => ({
        appointment_id: b.id,
        client_id: b.contact_id,
        type: b.title,
        guest: b.guest_name,
        guest_email: b.guest_email,
        starts: local(ctx, b.starts_at),
        starts_at: new Date(b.starts_at).toISOString(),
        ends: local(ctx, b.ends_at),
        status: b.status,
        location: b.location,
        guest_notes: untrusted(b.notes, 300),
      })),
    };
  },
};

const findFreeTime: ReadTool<{ date: string; duration: number }> = {
  kind: "read",
  name: "find_free_time",
  label: "Checked availability",
  description:
    "Find open time on one day: the user's weekly availability minus confirmed appointments and connected Google Calendar busy times. Returns open windows at least `duration_minutes` long.",
  input_schema: {
    type: "object",
    properties: {
      date: { type: "string", description: "Day to check, YYYY-MM-DD, in the user's timezone." },
      duration_minutes: { type: "integer", minimum: 5, maximum: 480 },
    },
    required: ["date"],
  },
  parse(raw) {
    const v = object(raw);
    return { date: day(v.date, "date", true), duration: int(v.duration_minutes, "duration_minutes", 5, 480, 60) };
  },
  async run(ctx, input) {
    const weekday = new Date(input.date + "T12:00:00Z").getUTCDay();
    const pool = getPool();
    const [hours, profile] = await Promise.all([
      pool.query("SELECT enabled,start_time,end_time FROM public.availability WHERE user_id=$1 AND day=$2", [ctx.userId, weekday]),
      pool.query("SELECT slug FROM public.profiles WHERE id=$1", [ctx.userId]),
    ]);
    const h = hours.rows[0];
    if (!h || !h.enabled) return { date: input.date, open: [], note: "This day is outside the user's weekly availability." };
    const start = zonedDate(input.date, String(h.start_time).slice(0, 5), ctx.timezone)!,
      end = zonedDate(input.date, String(h.end_time).slice(0, 5), ctx.timezone)!;
    const booked = (
      await pool.query(
        "SELECT starts_at,ends_at FROM public.bookings WHERE user_id=$1 AND status='confirmed' AND starts_at<$3 AND ends_at>$2",
        [ctx.userId, start.toISOString(), end.toISOString()],
      )
    ).rows.map((b) => ({ start: new Date(b.starts_at).toISOString(), end: new Date(b.ends_at).toISOString() }));
    let google: { start: string; end: string }[] = [],
      googleNote = "";
    try {
      google = await googleBusyForHost(profile.rows[0]?.slug || "", start.toISOString(), end.toISOString());
    } catch {
      googleNote = "Google Calendar couldn't be checked; confirm against it before offering these times.";
    }
    const busy = [...booked, ...google].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const open: { from: string; to: string; starts_at: string }[] = [];
    let cursor = Math.max(start.getTime(), Date.now());
    for (const b of busy) {
      if (Date.parse(b.start) - cursor >= input.duration * 60000)
        open.push({ from: local(ctx, new Date(cursor)), to: local(ctx, b.start), starts_at: new Date(cursor).toISOString() });
      cursor = Math.max(cursor, Date.parse(b.end));
    }
    if (end.getTime() - cursor >= input.duration * 60000)
      open.push({ from: local(ctx, new Date(cursor)), to: local(ctx, end), starts_at: new Date(cursor).toISOString() });
    return { date: input.date, duration_minutes: input.duration, open, note: googleNote || undefined };
  },
};

const searchClients: ReadTool<{ query: string; limit: number }> = {
  kind: "read",
  name: "search_clients",
  label: "Searched clients",
  description: "Search the user's clients by name, email or company. Use this to get a client_id before other client tools.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 25 } },
    required: ["query"],
  },
  parse(raw) {
    const v = object(raw);
    return { query: text(v.query, "query", 100), limit: int(v.limit, "limit", 1, 25, 10) };
  },
  async run(ctx, input) {
    const like = "%" + input.query.replace(/[\\%_]/g, "\\$&") + "%";
    const { rows } = await getPool().query(
      `SELECT c.id,c.name,c.email,c.company,(SELECT max(starts_at) FROM public.bookings b WHERE b.contact_id=c.id AND b.user_id=c.user_id AND b.status='confirmed') last_booking
         FROM public.contacts c WHERE c.user_id=$1 AND (c.name ILIKE $2 OR c.email ILIKE $2 OR c.company ILIKE $2) ORDER BY c.name LIMIT ${input.limit}`,
      [ctx.userId, like],
    );
    return {
      clients: rows.map((c) => ({
        client_id: c.id,
        name: c.name,
        email: c.email,
        company: c.company,
        last_booking: c.last_booking ? local(ctx, c.last_booking) : null,
      })),
    };
  },
};

const getClient: ReadTool<{ client: string }> = {
  kind: "read",
  name: "get_client",
  label: "Opened client record",
  description: "Get one client's details, appointment history, documents, open tasks and message thread summary.",
  input_schema: { type: "object", properties: { client_id: { type: "string" } }, required: ["client_id"] },
  parse(raw) {
    return { client: id(object(raw).client_id, "client_id") };
  },
  async run(ctx, input) {
    const c = await ownedContact(ctx, input.client);
    const pool = getPool();
    const [bookings, docs, tasks, phone] = await Promise.all([
      pool.query(
        "SELECT b.id,e.title,b.starts_at,b.status FROM public.bookings b JOIN public.event_types e ON e.id=b.event_id WHERE b.contact_id=$1 AND b.user_id=$2 ORDER BY b.starts_at DESC LIMIT 10",
        [c.id, ctx.userId],
      ),
      pool.query(
        "SELECT title,status FROM private.signature_envelopes WHERE contact_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 10",
        [c.id, ctx.userId],
      ),
      pool.query("SELECT title FROM private.client_tasks WHERE contact_id=$1 AND user_id=$2 AND NOT completed LIMIT 10", [
        c.id,
        ctx.userId,
      ]),
      contactPhone(pool, ctx.userId, c.id),
    ]);
    return {
      client_id: c.id,
      name: c.name,
      email: c.email,
      company: c.company,
      has_phone: !!phone,
      private_notes: untrusted(c.notes),
      appointments: bookings.rows.map((b) => ({ appointment_id: b.id, type: b.title, starts: local(ctx, b.starts_at), status: b.status })),
      documents: docs.rows,
      open_tasks: tasks.rows.map((t) => untrusted(t.title, 200)),
    };
  },
};

const inactiveClients: ReadTool<{ days: number; limit: number }> = {
  kind: "read",
  name: "find_inactive_clients",
  label: "Found inactive clients",
  description: "Find clients with no confirmed appointment in the last `days` days and none upcoming.",
  input_schema: {
    type: "object",
    properties: { days: { type: "integer", minimum: 7, maximum: 730 }, limit: { type: "integer", minimum: 1, maximum: 50 } },
  },
  parse(raw) {
    const v = object(raw);
    return { days: int(v.days, "days", 7, 730, 60), limit: int(v.limit, "limit", 1, 50, 20) };
  },
  async run(ctx, input) {
    const { rows } = await getPool().query(
      `SELECT c.id,c.name,c.email,max(b.starts_at) last_booking FROM public.contacts c
         LEFT JOIN public.bookings b ON b.contact_id=c.id AND b.user_id=c.user_id AND b.status='confirmed'
        WHERE c.user_id=$1 GROUP BY c.id
       HAVING coalesce(max(b.starts_at),'-infinity')<now()-make_interval(days=>$2)
        ORDER BY max(b.starts_at) DESC NULLS LAST LIMIT ${input.limit}`,
      [ctx.userId, input.days],
    );
    return {
      days: input.days,
      clients: rows.map((c) => ({
        client_id: c.id,
        name: c.name,
        email: c.email,
        last_booking: c.last_booking ? local(ctx, c.last_booking) : "never booked",
      })),
    };
  },
};

const listDocuments: ReadTool<{ status: string }> = {
  kind: "read",
  name: "list_documents",
  label: "Checked documents",
  description: "List signature documents. 'awaiting' returns documents sent and waiting for signatures, with which signers are still pending.",
  input_schema: {
    type: "object",
    properties: { status: { type: "string", enum: ["awaiting", "completed", "draft", "all"] } },
  },
  parse(raw) {
    return { status: oneOf(object(raw).status, "status", ["awaiting", "completed", "draft", "all"] as const, "awaiting") };
  },
  async run(ctx, input) {
    const filter = { awaiting: "e.status='sent'", completed: "e.status='completed'", draft: "e.status='draft'", all: "true" }[
      input.status as "all"
    ];
    const { rows } = await getPool().query(
      `SELECT e.id,e.title,e.status,e.sent_at,e.expires_at,
              coalesce((SELECT jsonb_agg(jsonb_build_object('name',r.name,'status',r.status)) FROM private.signature_recipients r WHERE r.envelope_id=e.id),'[]') signers
         FROM private.signature_envelopes e WHERE e.user_id=$1 AND ${filter} ORDER BY e.created_at DESC LIMIT 25`,
      [ctx.userId],
    );
    const legacy =
      input.status === "awaiting" || input.status === "all"
        ? (
            await getPool().query(
              "SELECT id,title,status,recipient_name FROM private.signing_documents WHERE user_id=$1 AND status='awaiting_signature' LIMIT 25",
              [ctx.userId],
            )
          ).rows
        : [];
    return {
      documents: rows.map((d) => ({
        document_id: d.id,
        title: untrusted(d.title, 160),
        status: d.status,
        sent: d.sent_at ? local(ctx, d.sent_at) : null,
        expires: d.expires_at ? local(ctx, d.expires_at) : null,
        signers: d.signers,
      })),
      text_agreements_awaiting: legacy.map((d) => ({ title: untrusted(d.title, 160), signer: d.recipient_name })),
    };
  },
};

const businessSummary: ReadTool<{ period: "week" | "month" | "quarter" }> = {
  kind: "read",
  name: "business_summary",
  label: "Summarized the business",
  description: "Totals for the last week, month or quarter: appointments, cancellations, new clients, payments collected and documents completed.",
  input_schema: { type: "object", properties: { period: { type: "string", enum: ["week", "month", "quarter"] } } },
  parse(raw) {
    return { period: oneOf(object(raw).period, "period", ["week", "month", "quarter"] as const, "month") };
  },
  async run(ctx, input) {
    const days = { week: 7, month: 30, quarter: 90 }[input.period];
    const { rows } = await getPool().query(
      `SELECT
        (SELECT count(*) FROM public.bookings WHERE user_id=$1 AND status='confirmed' AND starts_at>=now()-make_interval(days=>$2) AND starts_at<now())::int completed,
        (SELECT count(*) FROM public.bookings WHERE user_id=$1 AND status='cancelled' AND starts_at>=now()-make_interval(days=>$2))::int cancelled,
        (SELECT count(*) FROM public.bookings WHERE user_id=$1 AND status='confirmed' AND starts_at>=now() AND starts_at<now()+make_interval(days=>$2))::int upcoming,
        (SELECT count(*) FROM public.contacts WHERE user_id=$1 AND created_at>=now()-make_interval(days=>$2))::int new_clients,
        (SELECT coalesce(sum(amount_cents-refunded_cents),0) FROM private.appointment_payments WHERE user_id=$1 AND status IN ('paid','partially_refunded') AND created_at>=now()-make_interval(days=>$2))::int collected_cents,
        (SELECT count(*) FROM private.signature_envelopes WHERE user_id=$1 AND status='completed' AND completed_at>=now()-make_interval(days=>$2))::int documents_completed`,
      [ctx.userId, days],
    );
    const r = rows[0];
    return { period_days: days, ...r, collected: `$${(r.collected_cents / 100).toFixed(2)}` };
  },
};

const listBookingLinks: ReadTool<Record<string, never>> = {
  kind: "read",
  name: "list_booking_links",
  label: "Checked booking links",
  description: "List the user's booking links (appointment types) with their public URLs.",
  input_schema: { type: "object", properties: {} },
  parse() {
    return {};
  },
  async run(ctx) {
    const { rows } = await getPool().query(
      "SELECT e.title,e.slug,e.duration,e.active,p.slug host FROM public.event_types e JOIN public.profiles p ON p.id=e.user_id WHERE e.user_id=$1 AND e.deleted_at IS NULL ORDER BY e.created_at",
      [ctx.userId],
    );
    return {
      profile_url: rows[0] ? bookingUrl(rows[0].host) : null,
      links: rows.map((e) => ({ title: e.title, slug: e.slug, minutes: e.duration, active: e.active, url: bookingUrl(e.host, e.slug) })),
    };
  },
};

const listConversations: ReadTool<{ unread: boolean }> = {
  kind: "read",
  name: "list_conversations",
  label: "Checked the inbox",
  description: "List recent client message threads with unread counts and the latest message.",
  input_schema: { type: "object", properties: { unread_only: { type: "boolean" } } },
  parse(raw) {
    return { unread: object(raw).unread_only === true };
  },
  async run(ctx, input) {
    const { rows } = await getPool().query(
      `SELECT t.id,t.contact_id,c.name,t.status,
              (SELECT count(*) FROM private.thread_messages m WHERE m.thread_id=t.id AND m.direction='inbound' AND m.read_at IS NULL)::int unread,
              (SELECT body FROM private.thread_messages m WHERE m.thread_id=t.id ORDER BY created_at DESC LIMIT 1) last
         FROM private.message_threads t LEFT JOIN public.contacts c ON c.id=t.contact_id
        WHERE t.user_id=$1 ORDER BY t.last_message_at DESC LIMIT 20`,
      [ctx.userId],
    );
    return {
      threads: rows
        .filter((t) => !input.unread || t.unread)
        .map((t) => ({ client_id: t.contact_id, client: t.name, status: t.status, unread: t.unread, last_message: untrusted(t.last, 240) })),
    };
  },
};

const listJobs: ReadTool<{ status: string }> = {
  kind: "read",
  name: "list_jobs",
  label: "Checked jobs",
  description: "List contractor jobs and service requests with their status and latest estimate.",
  input_schema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["open", "requested", "approved", "scheduled", "in_progress", "completed", "all"] },
    },
  },
  parse(raw) {
    return {
      status: oneOf(
        object(raw).status,
        "status",
        ["open", "requested", "approved", "scheduled", "in_progress", "completed", "all"] as const,
        "open",
      ),
    };
  },
  async run(ctx, input) {
    const filter =
      input.status === "all"
        ? "true"
        : input.status === "open"
          ? "j.status IN ('requested','approved','scheduled','in_progress')"
          : "j.status=$2";
    const { rows } = await getPool().query(
      `SELECT j.id,j.title,j.category,j.status,j.updated_at,c.name client,
              (SELECT jsonb_build_object('status',e.status,'total_cents',e.total_cents) FROM private.estimates e WHERE e.job_id=j.id ORDER BY e.created_at DESC LIMIT 1) estimate
         FROM private.jobs j LEFT JOIN public.contacts c ON c.id=j.contact_id WHERE j.user_id=$1 AND ${filter} ORDER BY j.updated_at DESC LIMIT 25`,
      filter.includes("$2") ? [ctx.userId, input.status] : [ctx.userId],
    );
    return {
      jobs: rows.map((j) => ({
        job_id: j.id,
        title: untrusted(j.title, 120),
        category: j.category,
        status: j.status,
        client: j.client,
        updated: local(ctx, j.updated_at),
        estimate: j.estimate,
      })),
    };
  },
};

// ---- action tools (approval required) -------------------------------------------------------
type MessageInput = { client: string; channel: "email" | "sms"; body: string };
async function previewChannel(ctx: ToolContext, c: { id: string; email: string }, channel: string, body: string) {
  if (channel === "email") return { to: c.email, warning: undefined };
  const phone = await contactPhone(getPool(), ctx.userId, c.id);
  const ready = await smsReadiness(ctx.userId, phone, body);
  if (!ready.ok) throw new ApiError(`Text message can’t be sent: ${ready.detail}`, 409);
  return { to: phone, warning: `Sent from ${ready.sender}.` };
}
async function deliver(ctx: ToolContext, clientId: string, channel: "email" | "sms", body: string) {
  const db = await getPool().connect();
  let result;
  try {
    await db.query("BEGIN");
    const thread = await ensureContactThread(db, ctx.userId, clientId);
    result = await sendThreadMessage(db, {
      threadId: thread,
      actor: { id: ctx.userId, name: ctx.userName },
      channel,
      body,
    });
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
  if (channel === "email") {
    await drainDeliveries(ctx.userId, 3).catch(() => {});
    const job = (
      await getPool().query("SELECT status,last_error FROM private.delivery_jobs WHERE id=$1 AND user_id=$2", [
        result.deliveryJob,
        ctx.userId,
      ])
    ).rows[0];
    if (job?.status === "sent") return { status: "sent", detail: "" };
    if (job?.status === "failed") throw new ApiError(job.last_error || "The email couldn’t be sent.", 502);
    return { status: "queued", detail: "" };
  }
  return { status: result.status, detail: "" };
}

// Reports only what the delivery backend confirmed: "queued" is never described as delivered.
function deliveryMessage(subject: string, channel: string, status: string) {
  if (status === "sent" || status === "delivered")
    return `${subject} was accepted by the ${channel === "sms" ? "text message" : "email"} provider.`;
  if (status === "queued") return `${subject} is queued for ${channel === "sms" ? "text" : "email"} delivery. Its status updates in the inbox.`;
  return `${subject}: ${status}.`;
}

const sendMessage: ActionTool<MessageInput> = {
  kind: "action",
  name: "send_message",
  label: "Send a message",
  description:
    "Prepare a message to a client by email or SMS. The user must approve it before anything is sent; you will receive the preview, not a delivery confirmation.",
  input_schema: {
    type: "object",
    properties: {
      client_id: { type: "string" },
      channel: { type: "string", enum: ["email", "sms"] },
      body: { type: "string", description: "Full message text, written as the user." },
    },
    required: ["client_id", "channel", "body"],
  },
  parse(raw) {
    const v = object(raw);
    return {
      client: id(v.client_id, "client_id"),
      channel: oneOf(v.channel, "channel", ["email", "sms"] as const),
      body: text(v.body, "body", 1600),
    };
  },
  async prepare(ctx, input) {
    const c = await ownedContact(ctx, input.client);
    const route = await previewChannel(ctx, c, input.channel, input.body);
    return {
      title: `Send ${input.channel === "sms" ? "a text" : "an email"} to ${c.name}`,
      summary: input.body,
      details: [
        { label: "To", value: `${c.name} · ${route.to}` },
        { label: "Channel", value: input.channel === "sms" ? "Text message" : "Email (includes a link to their client portal)" },
      ],
      confirmLabel: "Send message",
      warning: route.warning,
    };
  },
  async execute(ctx, input) {
    const c = await ownedContact(ctx, input.client);
    const r = await deliver(ctx, c.id, input.channel, input.body);
    return { message: deliveryMessage(`Message to ${c.name}`, input.channel, r.status), data: r };
  },
};

const sendBookingLink: ActionTool<MessageInput & { link: string }> = {
  kind: "action",
  name: "send_booking_link",
  label: "Send booking link",
  description:
    "Prepare a message that sends a client a booking link. Use list_booking_links for slugs; omit booking_link_slug to send the profile page with every appointment type. Requires user approval.",
  input_schema: {
    type: "object",
    properties: {
      client_id: { type: "string" },
      booking_link_slug: { type: "string" },
      channel: { type: "string", enum: ["email", "sms"] },
      note: { type: "string", description: "Optional short personal note placed before the link." },
    },
    required: ["client_id", "channel"],
  },
  parse(raw) {
    const v = object(raw);
    const link = text(v.booking_link_slug, "booking_link_slug", 60, false);
    if (link && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(link)) throw new ToolInputError("booking_link_slug is invalid.");
    return {
      client: id(v.client_id, "client_id"),
      channel: oneOf(v.channel, "channel", ["email", "sms"] as const),
      body: text(v.note, "note", 600, false),
      link,
    };
  },
  async prepare(ctx, input) {
    const c = await ownedContact(ctx, input.client);
    const url = await linkFor(ctx, input.link);
    const body = composeBookingMessage(c.name, input.body, url.title, url.url);
    const route = await previewChannel(ctx, c, input.channel, body);
    return {
      title: `Send booking link to ${c.name}`,
      summary: body,
      details: [
        { label: "To", value: `${c.name} · ${route.to}` },
        { label: "Link", value: url.url },
      ],
      confirmLabel: "Send link",
      warning: route.warning,
    };
  },
  async execute(ctx, input) {
    const c = await ownedContact(ctx, input.client);
    const url = await linkFor(ctx, input.link);
    const r = await deliver(ctx, c.id, input.channel, composeBookingMessage(c.name, input.body, url.title, url.url));
    return { message: deliveryMessage(`Booking link for ${c.name}`, input.channel, r.status), data: r };
  },
};
async function linkFor(ctx: ToolContext, slug: string) {
  const host = await businessName(getPool(), ctx.userId);
  if (!slug) return { title: "", url: bookingUrl(host.slug) };
  const e = (
    await getPool().query(
      "SELECT title FROM public.event_types WHERE user_id=$1 AND slug=$2 AND active AND deleted_at IS NULL",
      [ctx.userId, slug],
    )
  ).rows[0];
  if (!e) throw new ApiError("That booking link isn’t active.", 404);
  return { title: e.title as string, url: bookingUrl(host.slug, slug) };
}
export function composeBookingMessage(name: string, note: string, title: string, url: string) {
  const first = name.split(" ")[0];
  return `${note ? note.trim() : `Hi ${first}, you can choose a time that works for you here`}\n\n${title ? title + ": " : ""}${url}`;
}

const cancelAppointment: ActionTool<{ booking: string }> = {
  kind: "action",
  name: "cancel_appointment",
  label: "Cancel appointment",
  description: "Prepare cancelling an appointment. The guest is notified by email after the user approves.",
  input_schema: { type: "object", properties: { appointment_id: { type: "string" } }, required: ["appointment_id"] },
  parse(raw) {
    return { booking: id(object(raw).appointment_id, "appointment_id") };
  },
  async prepare(ctx, input) {
    const b = await ownedBooking(ctx, input.booking);
    if (b.status !== "confirmed") throw new ApiError("That appointment is already cancelled.", 409);
    return {
      title: `Cancel ${b.title} with ${b.guest_name}`,
      summary: `This cancels the appointment and emails ${b.guest_name} a cancellation notice.`,
      details: [
        { label: "When", value: local(ctx, b.starts_at) },
        { label: "Guest", value: `${b.guest_name} · ${b.guest_email}` },
      ],
      confirmLabel: "Cancel appointment",
      danger: true,
    };
  },
  async execute(ctx, input) {
    const b = await ownedBooking(ctx, input.booking);
    if (b.status !== "confirmed") throw new ApiError("That appointment is already cancelled.", 409);
    await hostCancelBooking(ctx.userId, b.id);
    await afterBookingChange(ctx.userId);
    return { message: `Cancelled ${b.title} with ${b.guest_name} on ${local(ctx, b.starts_at)}.` };
  },
};

const rescheduleAppointment: ActionTool<{ booking: string; start: string }> = {
  kind: "action",
  name: "reschedule_appointment",
  label: "Reschedule appointment",
  description:
    "Prepare moving an appointment to a new start time (ISO 8601 with offset). Check find_free_time first. The guest is notified after approval.",
  input_schema: {
    type: "object",
    properties: { appointment_id: { type: "string" }, new_start: { type: "string" } },
    required: ["appointment_id", "new_start"],
  },
  parse(raw) {
    const v = object(raw);
    const start = instant(v.new_start, "new_start");
    if (Date.parse(start) < Date.now()) throw new ToolInputError("new_start must be in the future.");
    return { booking: id(v.appointment_id, "appointment_id"), start };
  },
  async prepare(ctx, input) {
    const b = await ownedBooking(ctx, input.booking);
    if (b.status !== "confirmed") throw new ApiError("Only confirmed appointments can be rescheduled.", 409);
    return {
      title: `Reschedule ${b.title} with ${b.guest_name}`,
      summary: `Moves the appointment and emails ${b.guest_name} the new time.`,
      details: [
        { label: "From", value: local(ctx, b.starts_at) },
        { label: "To", value: local(ctx, input.start) },
      ],
      confirmLabel: "Reschedule",
    };
  },
  async execute(ctx, input) {
    const b = await ownedBooking(ctx, input.booking);
    await hostRescheduleBooking(ctx.userId, b.id, input.start);
    await afterBookingChange(ctx.userId);
    return { message: `Moved ${b.title} with ${b.guest_name} to ${local(ctx, input.start)}.` };
  },
};

const updateClient: ActionTool<{ client: string; name?: string; company?: string; notes?: string }> = {
  kind: "action",
  name: "update_client",
  label: "Update client record",
  description: "Prepare changes to a client's name, company or private notes. Notes replace the existing notes. Requires approval.",
  input_schema: {
    type: "object",
    properties: {
      client_id: { type: "string" },
      name: { type: "string" },
      company: { type: "string" },
      notes: { type: "string" },
    },
    required: ["client_id"],
  },
  parse(raw) {
    const v = object(raw);
    const out = {
      client: id(v.client_id, "client_id"),
      name: v.name === undefined ? undefined : text(v.name, "name", 100),
      company: v.company === undefined ? undefined : text(v.company, "company", 100, false),
      notes: v.notes === undefined ? undefined : text(v.notes, "notes", 2000, false),
    };
    if (out.name === undefined && out.company === undefined && out.notes === undefined)
      throw new ToolInputError("Provide at least one field to change.");
    return out;
  },
  async prepare(ctx, input) {
    const c = await ownedContact(ctx, input.client);
    const details = (["name", "company", "notes"] as const)
      .filter((k) => input[k] !== undefined && input[k] !== c[k])
      .map((k) => ({ label: k[0].toUpperCase() + k.slice(1), value: `${c[k] || "—"} → ${input[k] || "—"}` }));
    if (!details.length) throw new ApiError("Those values already match the client record.", 409);
    return { title: `Update ${c.name}`, summary: "Changes the client record.", details, confirmLabel: "Save changes" };
  },
  async execute(ctx, input) {
    const c = await ownedContact(ctx, input.client);
    const { rowCount } = await getPool().query(
      "UPDATE public.contacts SET name=$3,company=$4,notes=$5 WHERE id=$1 AND user_id=$2",
      [c.id, ctx.userId, input.name ?? c.name, input.company ?? c.company, input.notes ?? c.notes],
    );
    if (!rowCount) throw new ApiError("The client record couldn’t be updated.", 409);
    await getPool().query(
      "INSERT INTO private.client_activity(user_id,contact_id,action) VALUES($1,$2,'Record updated by the assistant (approved)')",
      [ctx.userId, c.id],
    );
    return { message: `Updated ${input.name ?? c.name}.` };
  },
};

const createTask: ActionTool<{ client: string; title: string }> = {
  kind: "action",
  name: "create_follow_up_task",
  label: "Add follow-up task",
  description: "Prepare adding a follow-up task to a client's record. Requires approval.",
  input_schema: {
    type: "object",
    properties: { client_id: { type: "string" }, title: { type: "string" } },
    required: ["client_id", "title"],
  },
  parse(raw) {
    const v = object(raw);
    return { client: id(v.client_id, "client_id"), title: text(v.title, "title", 200) };
  },
  async prepare(ctx, input) {
    const c = await ownedContact(ctx, input.client);
    return {
      title: `Add a task for ${c.name}`,
      summary: input.title,
      details: [{ label: "Client", value: c.name }],
      confirmLabel: "Add task",
    };
  },
  async execute(ctx, input) {
    const c = await ownedContact(ctx, input.client);
    await getPool().query("INSERT INTO private.client_tasks(user_id,contact_id,title) VALUES($1,$2,$3)", [
      ctx.userId,
      c.id,
      input.title,
    ]);
    return { message: `Added “${input.title}” to ${c.name}.` };
  },
};

export const assistantTools: AssistantTool[] = [
  listAppointments,
  findFreeTime,
  searchClients,
  getClient,
  inactiveClients,
  listDocuments,
  businessSummary,
  listBookingLinks,
  listConversations,
  listJobs,
  sendMessage,
  sendBookingLink,
  cancelAppointment,
  rescheduleAppointment,
  updateClient,
  createTask,
];
export const toolByName = new Map(assistantTools.map((t) => [t.name, t]));

export function toolDefinitions(): Anthropic.Tool[] {
  return assistantTools.map((t) => ({
    name: t.name,
    description: t.kind === "action" ? t.description + " (Requires the user's approval.)" : t.description,
    input_schema: t.input_schema,
    eager_input_streaming: true,
  })) as Anthropic.Tool[];
}

// Used by the approval route: re-validates the stored input and re-authorizes before running.
export async function runApprovedAction(ctx: ToolContext, toolName: string, input: unknown) {
  const tool = toolByName.get(toolName);
  if (!tool || tool.kind !== "action") throw new ApiError("This action is no longer supported.", 410);
  let parsed;
  try {
    parsed = tool.parse(input);
  } catch (e) {
    throw new ApiError(e instanceof ToolInputError ? e.message : "This action’s details are invalid.", 422);
  }
  return tool.execute(ctx, parsed);
}
