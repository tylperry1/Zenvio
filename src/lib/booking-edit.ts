import type { PoolClient } from "pg";
import {
  formatAddress,
  isLocationMode,
  type LocationMode,
  type StructuredAddress,
} from "./addresses";
import {
  businessAddressForWorkspace,
  persistBookingAddress,
  resolveBookingLocation,
  type BookingLocationInput,
} from "./booking-address";
import { getPool } from "./db";
import { googleBusyForHost, overlapsBusy, runGoogleJobs } from "./google-calendar";
import { appOrigin, drainDeliveries, scheduleBooking } from "./lifecycle";
import { microsoftBusyForHost, runMicrosoftJobs } from "./microsoft-calendar";
import { deliverBookingEmails } from "./mail";
import { enqueueNotification } from "./notifications/engine";
import { ApiError } from "./server";

export type BookingEditPatch = {
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  guestCompany?: string;
  meetingPurpose?: string;
  notes?: string;
  startsAt?: string;
  endsAt?: string;
  eventId?: string;
  locationMode?: LocationMode | string;
  serviceAddress?: unknown;
  accessInstructions?: string;
  status?: "confirmed" | "cancelled";
};

export type BookingChangeField =
  | "starts_at"
  | "ends_at"
  | "duration"
  | "location"
  | "location_mode"
  | "access_instructions"
  | "guest_name"
  | "guest_email"
  | "guest_phone"
  | "guest_company"
  | "meeting_purpose"
  | "notes"
  | "event_id"
  | "status"
  | "assigned_employee";

export type BookingChange = {
  field: BookingChangeField;
  previous: unknown;
  next: unknown;
};

type BookingRow = {
  id: string;
  user_id: string;
  event_id: string;
  guest_name: string;
  guest_email: string;
  guest_phone: string | null;
  guest_company: string | null;
  meeting_purpose: string | null;
  notes: string | null;
  location: string | null;
  location_mode: string | null;
  service_address: StructuredAddress | Record<string, unknown> | null;
  access_instructions: string | null;
  starts_at: string | Date;
  ends_at: string | Date;
  status: string;
  revision: number;
  cancel_token: string;
  contact_id: string | null;
  buffer?: number;
  title?: string;
  slug?: string;
  timezone?: string;
  host_email?: string;
  virtual_instructions?: string;
  allowed_location_modes?: string[] | null;
  event_location?: string;
  event_location_mode?: string;
};

function clean(value: unknown, max: number) {
  return String(value ?? "")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .trim()
    .slice(0, max);
}

function iso(value: string | Date) {
  return new Date(value).toISOString();
}

function addressText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const a = value as StructuredAddress;
  return (a.formatted || formatAddress(a) || "").trim();
}

/** Compare persisted booking state to a proposed patch and return meaningful diffs only. */
export function detectBookingChanges(
  before: {
    starts_at: string | Date;
    ends_at: string | Date;
    guest_name: string;
    guest_email: string;
    guest_phone?: string | null;
    guest_company?: string | null;
    meeting_purpose?: string | null;
    notes?: string | null;
    location?: string | null;
    location_mode?: string | null;
    service_address?: unknown;
    access_instructions?: string | null;
    event_id?: string;
    status?: string;
    assigned_user_id?: string | null;
  },
  after: {
    starts_at?: string | Date;
    ends_at?: string | Date;
    guest_name?: string;
    guest_email?: string;
    guest_phone?: string | null;
    guest_company?: string | null;
    meeting_purpose?: string | null;
    notes?: string | null;
    location?: string | null;
    location_mode?: string | null;
    service_address?: unknown;
    access_instructions?: string | null;
    event_id?: string;
    status?: string;
    assigned_user_id?: string | null;
  },
): BookingChange[] {
  const changes: BookingChange[] = [];
  const push = (field: BookingChangeField, previous: unknown, next: unknown) => {
    if (previous === next) return;
    if (String(previous ?? "") === String(next ?? "")) return;
    changes.push({ field, previous, next });
  };

  if (after.starts_at != null) push("starts_at", iso(before.starts_at), iso(after.starts_at));
  if (after.ends_at != null) push("ends_at", iso(before.ends_at), iso(after.ends_at));
  if (after.starts_at != null && after.ends_at != null) {
    const prevDur = new Date(before.ends_at).getTime() - new Date(before.starts_at).getTime();
    const nextDur = new Date(after.ends_at).getTime() - new Date(after.starts_at).getTime();
    if (prevDur !== nextDur) push("duration", prevDur, nextDur);
  }
  if (after.guest_name != null) push("guest_name", before.guest_name, after.guest_name);
  if (after.guest_email != null) push("guest_email", before.guest_email, after.guest_email);
  if (after.guest_phone != null) push("guest_phone", before.guest_phone || "", after.guest_phone || "");
  if (after.guest_company != null)
    push("guest_company", before.guest_company || "", after.guest_company || "");
  if (after.meeting_purpose != null)
    push("meeting_purpose", before.meeting_purpose || "", after.meeting_purpose || "");
  if (after.notes != null) push("notes", before.notes || "", after.notes || "");
  if (after.location_mode != null)
    push("location_mode", before.location_mode || "", after.location_mode || "");
  if (after.location != null) push("location", before.location || "", after.location || "");
  if (after.service_address !== undefined) {
    const prev = addressText(before.service_address) || before.location || "";
    const next = addressText(after.service_address) || after.location || "";
    if (prev !== next) push("location", prev, next);
  }
  if (after.access_instructions != null)
    push(
      "access_instructions",
      before.access_instructions || "",
      after.access_instructions || "",
    );
  if (after.event_id != null) push("event_id", before.event_id || "", after.event_id);
  if (after.status != null) push("status", before.status || "", after.status);
  if (after.assigned_user_id !== undefined)
    push("assigned_employee", before.assigned_user_id || "", after.assigned_user_id || "");
  return changes;
}

function formatWhen(startsAt: string | Date, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: timezone || "UTC",
  }).format(new Date(startsAt));
}

async function loadEditableBooking(db: PoolClient, workspaceId: string, bookingId: string) {
  const { rows } = await db.query(
    `SELECT b.*, e.title, e.buffer, e.location AS event_location, e.location_mode AS event_location_mode,
            e.allowed_location_modes, e.virtual_instructions, p.slug, p.timezone, u.email AS host_email
       FROM public.bookings b
       JOIN public.event_types e ON e.id = b.event_id
       JOIN public.profiles p ON p.id = b.user_id
       JOIN public."user" u ON u.id = b.user_id
      WHERE b.id = $1 AND b.user_id = $2
      FOR UPDATE OF b`,
    [bookingId, workspaceId],
  );
  return (rows[0] as BookingRow | undefined) || null;
}

async function notifyBookingEdit(
  db: PoolClient,
  booking: BookingRow,
  changes: BookingChange[],
  actorId: string,
) {
  if (!changes.length) return;
  const when = formatWhen(booking.starts_at, booking.timezone || "UTC");
  const links = `\nManage or reschedule: ${appOrigin()}/reschedule#token=${booking.cancel_token}\nTimes shown in ${booking.timezone || "UTC"}.`;
  const title = booking.title || "Appointment";
  const revision = booking.revision;
  const recipients = [
    { to: booking.guest_email, contactId: booking.contact_id, role: "customer" as const },
    { to: booking.host_email || "", contactId: null, role: "employee" as const },
  ].filter((r) => r.to);

  const locationChange = changes.find((c) => c.field === "location" || c.field === "location_mode");
  const timeChange = changes.some((c) => c.field === "starts_at" || c.field === "ends_at");
  const cancelled = changes.some((c) => c.field === "status" && c.next === "cancelled");
  const assigneeChange = changes.find((c) => c.field === "assigned_employee");

  for (const recipient of recipients) {
    // Cancellation email still comes from the email_outbox → delivery_jobs bridge on status update.
    if (cancelled) continue;

    if (locationChange) {
      const emailKey = `location:${booking.id}:${revision}:${recipient.to}`;
      const previous = String(locationChange.previous || "Not specified");
      const next = String(locationChange.next || booking.location || "Not specified");
      const instructions = booking.access_instructions
        ? `\nLocation instructions: ${booking.access_instructions}`
        : "";
      const text =
        `Appointment Location Updated\n\n` +
        `Service: ${title}\n` +
        `When: ${when} (${booking.timezone || "UTC"})\n` +
        `Previous address: ${previous}\n` +
        `New address: ${next}` +
        instructions +
        links;
      await enqueueNotification(db, {
        workspaceId: booking.user_id,
        idempotencyKey: `notify:${emailKey}`,
        category: "appointment_reschedule",
        templateId: "appointment_location_update",
        channels: ["email", "push"],
        recipientAddress: recipient.to,
        recipientContactId: recipient.contactId,
        bookingId: booking.id,
        bookingRevision: revision,
        email: {
          kind: "booking_changed",
          key: emailKey,
          to: recipient.to,
          subject: `Appointment Location Updated: ${title}`,
          text,
          expires: new Date(booking.starts_at),
        },
        push: {
          title: "Appointment Location Updated",
          body: `${title} · ${next}`,
        },
      });
    }

    // Time moves already enqueue via scheduleBooking when revision bumps from move_booking.
    // Only send a generic update email when non-time, non-location fields changed alone,
    // or when location+other fields changed without a separate time move email.
    const otherOnly =
      !timeChange &&
      !locationChange &&
      changes.some((c) =>
        ["guest_name", "guest_email", "guest_phone", "meeting_purpose", "notes", "event_id", "access_instructions"].includes(
          c.field,
        ),
      );
    if (otherOnly || assigneeChange) {
      const emailKey = `updated:${booking.id}:${revision}:${recipient.to}`;
      const summary = changes
        .map((c) => `- ${c.field.replaceAll("_", " ")}: ${String(c.previous ?? "")} → ${String(c.next ?? "")}`)
        .join("\n");
      await enqueueNotification(db, {
        workspaceId: booking.user_id,
        idempotencyKey: `notify:${emailKey}`,
        category: "appointment_reschedule",
        templateId: "appointment_update",
        channels: ["email", "push"],
        recipientAddress: recipient.to,
        recipientContactId: recipient.contactId,
        bookingId: booking.id,
        bookingRevision: revision,
        email: {
          kind: "booking_changed",
          key: emailKey,
          to: recipient.to,
          subject: `Appointment updated: ${title}`,
          text: `Your appointment details were updated.\n\nService: ${title}\nWhen: ${when} (${booking.timezone || "UTC"})\n\nChanges:\n${summary}${links}`,
          expires: new Date(booking.starts_at),
        },
        push: { title: "Appointment updated", body: `${title} · ${when}` },
      });
    }
  }

  await db.query(
    `INSERT INTO private.booking_activity(booking_id, actor_id, action, details)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [
      booking.id,
      actorId,
      cancelled ? "cancelled" : locationChange ? "location_updated" : timeChange ? "rescheduled" : "updated",
      JSON.stringify({
        changes,
        notifications: recipients.map((r) => r.to),
        revision,
      }),
    ],
  );
}

/** Host-authorized appointment edit with change detection, location persistence, and notifications. */
export async function hostEditBooking(
  workspaceId: string,
  bookingId: string,
  patch: BookingEditPatch,
  actorId = workspaceId,
) {
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [workspaceId]);
    const booking = await loadEditableBooking(db, workspaceId, bookingId);
    if (!booking) throw new ApiError("Appointment not found.", 404);
    if (booking.status === "cancelled" && patch.status !== "cancelled")
      throw new ApiError("Cancelled appointments cannot be edited.", 409);

    const nextGuestName = patch.guestName != null ? clean(patch.guestName, 120) : booking.guest_name;
    const nextGuestEmail =
      patch.guestEmail != null ? clean(patch.guestEmail, 254).toLowerCase() : booking.guest_email;
    const nextGuestPhone = patch.guestPhone != null ? clean(patch.guestPhone, 40) : booking.guest_phone || "";
    const nextGuestCompany =
      patch.guestCompany != null ? clean(patch.guestCompany, 120) : booking.guest_company || "";
    const nextPurpose =
      patch.meetingPurpose != null ? clean(patch.meetingPurpose, 500) : booking.meeting_purpose || "";
    const nextNotes = patch.notes != null ? clean(patch.notes, 2000) : booking.notes || "";
    if (!nextGuestName || !nextGuestEmail.includes("@"))
      throw new ApiError("Customer name and a valid email are required.");

    let nextStarts = iso(booking.starts_at);
    let nextEnds = iso(booking.ends_at);
    let moved = false;

    if (patch.startsAt) {
      const start = clean(patch.startsAt, 40);
      if (!Number.isFinite(Date.parse(start))) throw new ApiError("Choose a valid start time.");
      let end: string;
      if (patch.endsAt && Number.isFinite(Date.parse(patch.endsAt))) {
        end = new Date(patch.endsAt).toISOString();
        if (Date.parse(end) <= Date.parse(start)) throw new ApiError("End time must be after the start time.");
      } else {
        const duration =
          new Date(booking.ends_at).getTime() - new Date(booking.starts_at).getTime();
        end = new Date(Date.parse(start) + duration).toISOString();
      }
      const bufferMs = (booking.buffer || 0) * 60000;
      const busyEnd = new Date(Date.parse(end) + bufferMs).toISOString();
      if (
        overlapsBusy(start, busyEnd, [
          ...(await googleBusyForHost(booking.slug || "", start, busyEnd)),
          ...(await microsoftBusyForHost(booking.slug || "", start, busyEnd)),
        ])
      )
        throw new ApiError("That time is no longer available.", 409);
      const result = (
        await db.query("SELECT private.move_booking($1,$2,$3,$4) result", [
          booking.id,
          start,
          workspaceId,
          null,
        ])
      ).rows[0].result;
      nextStarts = result.starts_at;
      nextEnds = result.ends_at;
      moved = true;
    }

    if (patch.status === "cancelled" && booking.status !== "cancelled") {
      await db.query(
        `UPDATE public.bookings SET status='cancelled', revision=revision+1 WHERE id=$1 AND user_id=$2`,
        [booking.id, workspaceId],
      );
    }

    let locationMode = (booking.location_mode as LocationMode) || "custom";
    let locationText = booking.location || "";
    let serviceAddress = (booking.service_address as StructuredAddress | null) || null;
    let accessInstructions = booking.access_instructions || "";
    let locationTouched =
      patch.locationMode != null ||
      patch.serviceAddress !== undefined ||
      patch.accessInstructions != null;

    if (locationTouched) {
      const event = {
        location: booking.event_location || booking.location || "",
        location_mode: booking.event_location_mode || booking.location_mode || "custom",
        allowed_location_modes: booking.allowed_location_modes,
        virtual_instructions: booking.virtual_instructions || "",
      };
      const guest: BookingLocationInput = {
        locationMode: patch.locationMode ?? booking.location_mode,
        serviceAddress: patch.serviceAddress !== undefined ? patch.serviceAddress : booking.service_address,
        accessInstructions:
          patch.accessInstructions != null ? patch.accessInstructions : booking.access_instructions,
      };
      if (patch.locationMode != null && !isLocationMode(patch.locationMode))
        throw new ApiError("Choose a valid location type.");
      const resolved = resolveBookingLocation({
        event,
        businessAddress: await businessAddressForWorkspace(db, workspaceId),
        guest,
      });
      await persistBookingAddress(db, {
        workspaceId,
        bookingId: booking.id,
        contactId: booking.contact_id,
        guestEmail: nextGuestEmail,
        guestPhone: nextGuestPhone,
        locationMode: resolved.locationMode,
        locationText: resolved.locationText,
        serviceAddress: resolved.serviceAddress,
        accessInstructions: resolved.accessInstructions,
        // Never overwrite residential from host appointment destination edits.
        saveAsResidential: false,
        skipContactAddressSave: true,
      });
      locationMode = resolved.locationMode;
      locationText = resolved.locationText;
      serviceAddress = resolved.serviceAddress;
      accessInstructions = resolved.accessInstructions;
      await db.query(
        `UPDATE public.bookings SET revision = revision + 1 WHERE id = $1 AND user_id = $2`,
        [booking.id, workspaceId],
      );
    }

    await db.query(
      `UPDATE public.bookings
          SET guest_name = $3,
              guest_email = $4,
              guest_phone = $5,
              guest_company = $6,
              meeting_purpose = $7,
              notes = $8,
              event_id = COALESCE($9::uuid, event_id)
        WHERE id = $1 AND user_id = $2`,
      [
        booking.id,
        workspaceId,
        nextGuestName,
        nextGuestEmail,
        nextGuestPhone,
        nextGuestCompany,
        nextPurpose,
        nextNotes,
        patch.eventId || null,
      ],
    );

    const refreshed = await loadEditableBooking(db, workspaceId, bookingId);
    if (!refreshed) throw new ApiError("Appointment not found.", 404);

    const changes = detectBookingChanges(
      {
        starts_at: booking.starts_at,
        ends_at: booking.ends_at,
        guest_name: booking.guest_name,
        guest_email: booking.guest_email,
        guest_phone: booking.guest_phone,
        guest_company: booking.guest_company,
        meeting_purpose: booking.meeting_purpose,
        notes: booking.notes,
        location: booking.location,
        location_mode: booking.location_mode,
        service_address: booking.service_address,
        access_instructions: booking.access_instructions,
        event_id: booking.event_id,
        status: booking.status,
      },
      {
        starts_at: nextStarts,
        ends_at: nextEnds,
        guest_name: nextGuestName,
        guest_email: nextGuestEmail,
        guest_phone: nextGuestPhone,
        guest_company: nextGuestCompany,
        meeting_purpose: nextPurpose,
        notes: nextNotes,
        location: locationText,
        location_mode: locationMode,
        service_address: serviceAddress,
        access_instructions: accessInstructions,
        event_id: patch.eventId || booking.event_id,
        status: patch.status === "cancelled" ? "cancelled" : refreshed.status,
      },
    );

    if (!changes.length) {
      await db.query("COMMIT");
      return { booking: refreshed, changes: [], saved: false };
    }

    // Refresh reminders always. Generic "moved" emails only when the start/end time changed;
    // location and field-only updates use targeted copy in notifyBookingEdit.
    if (refreshed.status === "confirmed") {
      await scheduleBooking(db, booking.id, { skipChangeEmails: !moved });
    }

    await notifyBookingEdit(db, refreshed, changes, actorId);
    await db.query("COMMIT");
    return { booking: refreshed, changes, saved: true };
  } catch (e) {
    await db.query("ROLLBACK");
    const message = (e as { message?: string }).message || "";
    if (message.includes("slot_unavailable") || (e as { code?: string }).code === "23P01")
      throw new ApiError("That time is no longer available.", 409);
    if (message.includes("reschedule_policy"))
      throw new ApiError("The rescheduling deadline has passed.", 409);
    throw e;
  } finally {
    db.release();
  }
}

export async function afterHostEdit(workspaceId: string) {
  await Promise.allSettled([
    drainDeliveries(workspaceId),
    deliverBookingEmails(),
    runGoogleJobs(workspaceId),
    runMicrosoftJobs(workspaceId),
  ]);
}

export async function bookingEditDetail(workspaceId: string, bookingId: string) {
  const db = await getPool().connect();
  try {
    const { rows } = await db.query(
      `SELECT b.id, b.event_id, b.guest_name, b.guest_email, b.guest_phone, b.guest_company,
              b.meeting_purpose, b.notes, b.location, b.location_mode, b.service_address,
              b.access_instructions, b.starts_at, b.ends_at, b.status, b.revision, b.contact_id,
              e.title, e.duration, e.buffer, e.location_mode AS event_location_mode,
              e.allowed_location_modes, e.virtual_instructions, p.timezone, p.slug
         FROM public.bookings b
         JOIN public.event_types e ON e.id = b.event_id
         JOIN public.profiles p ON p.id = b.user_id
        WHERE b.id = $1 AND b.user_id = $2`,
      [bookingId, workspaceId],
    );
    const booking = rows[0];
    if (!booking) throw new ApiError("Appointment not found.", 404);

    const history = (
      await db.query(
        `SELECT id, action, details, actor_id, created_at
           FROM private.booking_activity
          WHERE booking_id = $1
          ORDER BY created_at DESC
          LIMIT 50`,
        [bookingId],
      )
    ).rows;

    const notifications = (
      await db.query(
        `SELECT n.id, n.category, n.template_id, n.status, n.recipient_address, n.created_at,
                n.booking_revision, n.processed_at,
                COALESCE(
                  (
                    SELECT jsonb_agg(jsonb_build_object(
                      'channel', a.channel,
                      'status', a.status,
                      'failureReason', a.failure_reason,
                      'provider', a.provider
                    ) ORDER BY a.created_at)
                    FROM private.notification_attempts a
                   WHERE a.notification_id = n.id
                  ),
                  '[]'::jsonb
                ) AS attempts
           FROM private.notifications n
          WHERE n.booking_id = $1 AND n.workspace_id = $2
          ORDER BY n.created_at DESC
          LIMIT 40`,
        [bookingId, workspaceId],
      )
    ).rows;

    return { booking, history, notifications };
  } finally {
    db.release();
  }
}
