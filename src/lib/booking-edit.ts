import type { PoolClient } from "pg";
import {
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
import { detectBookingChanges as detectBookingChangesImpl } from "./booking-edit-detect.mjs";
import { getPool } from "./db";
import { googleBusyForHost, overlapsBusy, runGoogleJobs } from "./google-calendar";
import { appOrigin, drainDeliveries, scheduleBooking } from "./lifecycle";
import { microsoftBusyForHost, runMicrosoftJobs } from "./microsoft-calendar";
import { deliverBookingEmails } from "./mail";
import { enqueueNotification } from "./notifications/engine";
import { ApiError } from "./server";

export { detectBookingChangesImpl as detectBookingChanges };

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

function formatWhen(startsAt: string | Date, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: timezone || "UTC",
  }).format(new Date(startsAt));
}

function locationLabelFallback(mode: string) {
  if (mode === "virtual") return "Virtual meeting";
  if (mode === "at_business") return "Business location";
  if (mode === "at_customer") return "Customer location";
  if (mode === "custom") return "Custom meeting location";
  return mode || "Not specified";
}

async function queueCalendarSync(db: PoolClient, bookingId: string, userId: string) {
  await db.query(
    `INSERT INTO private.google_calendar_jobs(booking_id, user_id)
     SELECT $1, $2
      WHERE EXISTS (
        SELECT 1 FROM private.google_calendar_connections
         WHERE user_id = $2 AND sync_events
      )
     ON CONFLICT (booking_id) DO UPDATE
       SET attempts = 0,
           not_before = now(),
           last_error = NULL,
           revision = private.google_calendar_jobs.revision + 1,
           updated_at = now()`,
    [bookingId, userId],
  );
  await db.query(
    `INSERT INTO private.microsoft_calendar_jobs(booking_id, user_id)
     SELECT $1, $2
      WHERE EXISTS (
        SELECT 1 FROM private.microsoft_calendar_connections
         WHERE user_id = $2 AND sync_events
      )
     ON CONFLICT (booking_id) DO UPDATE
       SET attempts = 0,
           not_before = now(),
           last_error = NULL,
           revision = private.microsoft_calendar_jobs.revision + 1`,
    [bookingId, userId],
  );
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

  const locationTextChange = changes.find((c) => c.field === "location");
  const locationModeChange = changes.find((c) => c.field === "location_mode");
  const accessChange = changes.find((c) => c.field === "access_instructions");
  const locationChange = locationTextChange || locationModeChange || accessChange;
  const timeChange = changes.some((c) => c.field === "starts_at" || c.field === "ends_at");
  const cancelled = changes.some((c) => c.field === "status" && c.next === "cancelled");
  const guestEmailChanged = changes.some((c) => c.field === "guest_email");
  const assigneeChange = changes.find((c) => c.field === "assigned_employee");
  // Internal notes must never appear in customer-facing copy.
  const customerVisibleFields = new Set([
    "guest_name",
    "guest_email",
    "guest_phone",
    "guest_company",
    "meeting_purpose",
    "access_instructions",
    "event_id",
    "assigned_employee",
  ]);

  for (const recipient of recipients) {
    // Cancellation email still comes from the email_outbox → delivery_jobs bridge on status update.
    if (cancelled) continue;

    if (locationChange) {
      const emailKey = `location:${booking.id}:${revision}:${recipient.to}`;
      // Prefer real location snapshots; for instruction-only edits keep the current address.
      const currentLocation = String(booking.location || "").trim() || "Not specified";
      // Empty previous location snapshot must stay "Not specified" — never borrow the new address.
      const previousAddress = locationTextChange
        ? String(locationTextChange.previous || "").trim() || "Not specified"
        : locationModeChange
          ? locationLabelFallback(String(locationModeChange.previous || "")) || "Not specified"
          : currentLocation;
      const nextAddress = locationTextChange
        ? String(locationTextChange.next || "").trim() || currentLocation
        : locationModeChange
          ? locationLabelFallback(String(locationModeChange.next || "")) || currentLocation
          : currentLocation;
      // When the guest identity changed, do not reveal prior gate codes / entry notes.
      const instructionLines = accessChange
        ? guestEmailChanged
          ? `\nLocation instructions: ${String(accessChange.next || "None")}`
          : `\nPrevious instructions: ${String(accessChange.previous || "None")}\nNew instructions: ${String(accessChange.next || "None")}`
        : booking.access_instructions
          ? `\nLocation instructions: ${booking.access_instructions}`
          : "";
      const modeLine = locationModeChange
        ? `\nLocation type: ${locationLabelFallback(String(locationModeChange.previous || ""))} → ${locationLabelFallback(String(locationModeChange.next || ""))}`
        : "";
      // Instruction-only edits: show current address once, not a Previous/New address diff.
      const addressLines =
        locationTextChange || locationModeChange
          ? `Previous address: ${previousAddress}\nNew address: ${nextAddress}`
          : accessChange
            ? `Address: ${currentLocation}`
            : `Previous address: ${previousAddress}\nNew address: ${nextAddress}`;
      const text =
        `Appointment Location Updated\n\n` +
        `Service: ${title}\n` +
        `When: ${when} (${booking.timezone || "UTC"})\n` +
        addressLines +
        modeLine +
        instructionLines +
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
          body: `${title} · ${nextAddress}`,
        },
      });
    }

    // Time moves already enqueue via scheduleBooking when revision bumps from move_booking.
    // Customer emails omit internal notes; hosts still get a full field summary in activity.
    const customerFacing =
      !timeChange &&
      !locationChange &&
      (assigneeChange ||
        changes.some((c) => customerVisibleFields.has(c.field)));
    if (customerFacing) {
      const emailKey = `updated:${booking.id}:${revision}:${recipient.to}`;
      const summary = changes
        .filter((c) => customerVisibleFields.has(c.field))
        .map((c) => `- ${c.field.replaceAll("_", " ")}: ${String(c.previous ?? "")} → ${String(c.next ?? "")}`)
        .join("\n");
      if (!summary) continue;
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

  // Lifecycle already records reschedule/cancel activity on starts_at/ends_at/status.
  const lifecycleHandled =
    cancelled ||
    (timeChange &&
      changes.every((c) => ["starts_at", "ends_at", "duration"].includes(c.field)));
  if (!lifecycleHandled) {
    await db.query(
      `INSERT INTO private.booking_activity(booking_id, actor_id, action, details)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        booking.id,
        actorId,
        locationChange ? "location_updated" : "updated",
        JSON.stringify({
          changes,
          notifications: recipients.map((r) => r.to),
          revision,
        }),
      ],
    );
  }
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
      const start = new Date(clean(patch.startsAt, 40)).toISOString();
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
      const sameSlot =
        iso(booking.starts_at) === start && iso(booking.ends_at) === end;
      if (!sameSlot) {
        const bufferMs = (booking.buffer || 0) * 60000;
        const busyEnd = new Date(Date.parse(end) + bufferMs).toISOString();
        if (
          overlapsBusy(start, busyEnd, [
            ...(await googleBusyForHost(booking.slug || "", start, busyEnd)),
            ...(await microsoftBusyForHost(booking.slug || "", start, busyEnd)),
          ])
        )
          throw new ApiError("That time is no longer available.", 409);
        const durationMs = Date.parse(end) - Date.parse(start);
        if (durationMs < 5 * 60000 || durationMs > 24 * 60 * 60000)
          throw new ApiError("Choose an end time between 5 minutes and 24 hours after the start.");
        const previousDurationMs =
          Date.parse(iso(booking.ends_at)) - Date.parse(iso(booking.starts_at));
        // move_booking derives duration from ends_at-starts_at. Align duration first so
        // opening-hours and destination overlap checks use the requested window.
        // Do not overlap-check at the original start — a longer duration there can 409
        // even when the destination slot is free. move_booking validates the move.
        if (durationMs !== previousDurationMs) {
          const alignedEnd = new Date(Date.parse(iso(booking.starts_at)) + durationMs).toISOString();
          const alignedBlocked = new Date(Date.parse(alignedEnd) + bufferMs).toISOString();
          await db.query(
            `UPDATE public.bookings
                SET ends_at = $3::timestamptz,
                    blocked_until = $4::timestamptz
              WHERE id = $1 AND user_id = $2`,
            [booking.id, workspaceId, alignedEnd, alignedBlocked],
          );
        }
        const result = (
          await db.query("SELECT private.move_booking($1,$2,$3,$4) result", [
            booking.id,
            start,
            workspaceId,
            null,
          ])
        ).rows[0].result;
        nextStarts = iso(result.starts_at);
        nextEnds = iso(result.ends_at);
        moved = true;
      }
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
    const locationPatchRequested =
      patch.locationMode != null ||
      patch.serviceAddress !== undefined ||
      patch.accessInstructions != null;

    if (locationPatchRequested) {
      const event = {
        location: booking.event_location || booking.location || "",
        location_mode: booking.event_location_mode || booking.location_mode || "custom",
        allowed_location_modes: booking.allowed_location_modes,
        virtual_instructions: booking.virtual_instructions || "",
      };
      // Precedence: top-level patch.accessInstructions (incl. "") → nested serviceAddress
      // accessInstructions on a nested-only patch → preserve stored booking instructions.
      const nestedAccess =
        patch.serviceAddress !== undefined &&
        patch.serviceAddress &&
        typeof patch.serviceAddress === "object" &&
        (patch.serviceAddress as StructuredAddress).accessInstructions != null
          ? String((patch.serviceAddress as StructuredAddress).accessInstructions)
          : null;
      const guest: BookingLocationInput = {
        locationMode: patch.locationMode ?? booking.location_mode,
        serviceAddress: patch.serviceAddress !== undefined ? patch.serviceAddress : booking.service_address,
        accessInstructions:
          patch.accessInstructions != null
            ? patch.accessInstructions
            : nestedAccess != null
              ? nestedAccess
              : booking.access_instructions,
      };
      if (patch.locationMode != null && !isLocationMode(patch.locationMode))
        throw new ApiError("Choose a valid location type.");
      const resolved = resolveBookingLocation({
        event,
        businessAddress: await businessAddressForWorkspace(db, workspaceId),
        guest,
      });
      locationMode = resolved.locationMode;
      locationText = resolved.locationText;
      serviceAddress = resolved.serviceAddress;
      accessInstructions = resolved.accessInstructions;
    }

    // eventId is intentionally not writable from the host edit API until ownership
    // validation ships with a service-type picker. Ignore any client-provided value.
    const proposed = {
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
      event_id: booking.event_id,
      status: patch.status === "cancelled" ? "cancelled" : booking.status,
    };

    const changes = detectBookingChangesImpl(
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
      proposed,
    ) as BookingChange[];

    if (!changes.length) {
      await db.query("COMMIT");
      const current = await loadEditableBooking(db, workspaceId, bookingId);
      return { booking: current || booking, changes: [], saved: false };
    }

    const locationChanged = changes.some((c) =>
      ["location", "location_mode", "access_instructions"].includes(c.field),
    );
    if (locationChanged) {
      await persistBookingAddress(db, {
        workspaceId,
        bookingId: booking.id,
        contactId: booking.contact_id,
        guestEmail: nextGuestEmail,
        guestPhone: nextGuestPhone,
        locationMode,
        locationText,
        serviceAddress,
        accessInstructions,
        // Never overwrite residential from host appointment destination edits.
        saveAsResidential: false,
        skipContactAddressSave: true,
      });
    }

    const emailChanged = nextGuestEmail !== (booking.guest_email || "").toLowerCase();
    // Replacing the customer must not leave the previous contact able to open the portal.
    if (emailChanged) {
      const linked = (
        await db.query(
          `SELECT id FROM public.contacts
            WHERE user_id = $1 AND email = lower(trim($2))
            LIMIT 1`,
          [workspaceId, nextGuestEmail],
        )
      ).rows[0]?.id as string | undefined;
      await db.query(
        `UPDATE public.bookings
            SET guest_name = $3,
                guest_email = $4,
                guest_phone = $5,
                guest_company = $6,
                meeting_purpose = $7,
                notes = $8,
                contact_id = $9,
                cancel_token = gen_random_uuid()
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
          linked || null,
        ],
      );
    } else {
      await db.query(
        `UPDATE public.bookings
            SET guest_name = $3,
                guest_email = $4,
                guest_phone = $5,
                guest_company = $6,
                meeting_purpose = $7,
                notes = $8
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
        ],
      );
    }

    // Time moves already bump revision via move_booking / lifecycle. Cancel bumps above.
    // Only bump for customer-visible / location fields so internal-note edits do not
    // orphan pending confirmation emails keyed to the prior revision.
    const customerFacingChange = changes.some((c) =>
      [
        "location",
        "location_mode",
        "access_instructions",
        "guest_name",
        "guest_email",
        "guest_phone",
        "guest_company",
        "meeting_purpose",
        "event_id",
        "assigned_employee",
      ].includes(c.field),
    );
    const previousGuestEmail = (booking.guest_email || "").toLowerCase();
    // Guest email change: never revive pending confirmations addressed to the old customer.
    if (emailChanged) {
      await db.query(
        `UPDATE private.email_outbox
            SET migrated_at = now(), message = ''
          WHERE booking_id = $1
            AND sent_at IS NULL
            AND migrated_at IS NULL
            AND lower(recipient) = $2`,
        [booking.id, previousGuestEmail],
      );
      await db.query(
        `UPDATE private.delivery_jobs
            SET status = 'cancelled',
                payload_ciphertext = NULL,
                calendar_ciphertext = NULL
          WHERE booking_id = $1
            AND status = 'queued'
            AND kind IN ('booking_confirmation', 'booking_reminder')
            AND lower(recipient) = $2`,
        [booking.id, previousGuestEmail],
      );
    }

    // Location edits must not carry forward a confirmation that still embeds the old address.
    // Location-update email covers the guest; scheduleBooking refreshes reminders.
    if (locationChanged) {
      await db.query(
        `UPDATE private.delivery_jobs
            SET status = 'cancelled',
                payload_ciphertext = NULL,
                calendar_ciphertext = NULL
          WHERE booking_id = $1
            AND status = 'queued'
            AND kind = 'booking_confirmation'`,
        [booking.id],
      );
    }

    const needsRevisionBump =
      !moved && patch.status !== "cancelled" && customerFacingChange;
    if (needsRevisionBump) {
      const priorRevision = booking.revision;
      const bumped = (
        await db.query(
          `UPDATE public.bookings SET revision = revision + 1 WHERE id = $1 AND user_id = $2 RETURNING revision`,
          [booking.id, workspaceId],
        )
      ).rows[0];
      // Keep unsent confirmations (outbox + queued delivery_jobs) on the live revision,
      // except old-guest / stale-location mail already cancelled above.
      // Do not carry reminders — scheduleBooking enqueues fresh ones for this revision.
      if (bumped?.revision != null) {
        await db.query(
          `UPDATE private.email_outbox
              SET booking_revision = $2
            WHERE booking_id = $1
              AND sent_at IS NULL
              AND migrated_at IS NULL`,
          [booking.id, bumped.revision],
        );
        await db.query(
          `UPDATE private.delivery_jobs
              SET booking_revision = $2
            WHERE booking_id = $1
              AND status = 'queued'
              AND booking_revision = $3
              AND kind = 'booking_confirmation'`,
          [booking.id, bumped.revision, priorRevision],
        );
      }
    }

    if (changes.some((c) => c.field === "guest_name")) {
      await queueCalendarSync(db, booking.id, workspaceId);
    }

    const refreshed = await loadEditableBooking(db, workspaceId, bookingId);
    if (!refreshed) throw new ApiError("Appointment not found.", 404);

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
