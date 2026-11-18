import { icsContent } from "./scheduling.mjs";
import { bookingCalendarTitle, bookingCalendarDescription } from "./calendar-invitation.mjs";
import { deliverySender } from "./booking-email";
import { transactionalEmail } from "./transactional-email";
import { resendFailure, ResendDeliveryError } from "./resend-diagnostics";
import type { PoolClient } from "pg";
import { getPool } from "./db";
import {
  integrationValue,
  sealSecret,
  unsealSecret,
} from "./platform-settings";
import { ApiError } from "./server";
import { createHash } from "node:crypto";
import { resolveAppOrigin } from "./transactional-email";
import { syncNotificationAttemptFromDeliveryJob } from "./notifications/delivery-sync";
/** Canonical public origin for portal/Stripe/lifecycle links. Preserves local CI loopback. */
export const appOrigin = () => resolveAppOrigin();
export async function queueDelivery(
  db: PoolClient,
  input: {
    user: string | null;
    earlyAccess?: string;
    kind: string;
    key: string;
    to: string;
    subject: string;
    text: string;
    at?: Date;
    expires?: Date;
    booking?: string;
    revision?: number;
    envelope?: string;
    recipient?: string;
    document?: string;
  },
) {
  let calendar: string | null = null;
  let text = input.text;
  if (input.booking && ["booking_confirmation", "booking_changed", "booking_reminder"].includes(input.kind)) {
    const b = (await db.query(
      `SELECT b.*,e.title,coalesce(b.location,e.location) AS location,e.description,
              b.location_mode,b.service_address,b.access_instructions,b.guest_phone
         FROM public.bookings b
         JOIN public.event_types e ON e.id=b.event_id
        WHERE b.id=$1 AND b.user_id=$2`,
      [input.booking, input.user],
    )).rows[0];
    if (b && (input.revision === undefined || b.revision === input.revision)) {
      const title = bookingCalendarTitle(b.title, b.guest_name);
      const description = bookingCalendarDescription(b.description, b.intake_snapshot);
      // Calendar attachments stay location-only; phone is never exported to ICS.
      calendar = sealSecret(icsContent({...b, title, location: b.location || "", description}));
      const service =
        b.service_address && typeof b.service_address === "object"
          ? String((b.service_address as { formatted?: string }).formatted || "")
          : "";
      const details = [
        `Appointment: ${title}`,
        `Location: ${b.location || "Not specified"}`,
        service && service !== b.location ? `Service address: ${service}` : "",
        b.access_instructions ? `Access: ${b.access_instructions}` : "",
        b.guest_phone ? `Telephone: ${b.guest_phone}` : "",
        description || "",
      ]
        .filter(Boolean)
        .join("\n");
      text += `\n\n${details}`;
    }
  }
  await db.query(
    `INSERT INTO private.delivery_jobs(user_id,kind,dedupe_key,recipient,subject,payload_ciphertext,run_at,expires_at,booking_id,booking_revision,envelope_id,recipient_id,document_id,early_access_id,calendar_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(dedupe_key) DO NOTHING`,
    [
      input.user,
      input.kind,
      input.key,
      input.to,
      input.subject,
      sealSecret(text),
      input.at || new Date(),
      input.expires || new Date(Date.now() + 14 * 86400000),
      input.booking || null,
      input.revision ?? null,
      input.envelope || null,
      input.recipient || null,
      input.document || null,
      input.earlyAccess || null,
      calendar,
    ],
  );
}
export async function scheduleBooking(
  db: PoolClient,
  id: string,
  options?: { skipChangeEmails?: boolean },
) {
  await db.query(
    "UPDATE public.bookings b SET contact_id=c.id FROM public.contacts c WHERE b.id=$1 AND b.contact_id IS NULL AND c.user_id=b.user_id AND c.email=b.guest_email",
    [id],
  );
  const { rows } = await db.query(
    `SELECT b.*,e.title,e.reminder_minutes,p.timezone,u.email host_email FROM public.bookings b JOIN public.event_types e ON e.id=b.event_id JOIN public.profiles p ON p.id=b.user_id JOIN public."user" u ON u.id=b.user_id WHERE b.id=$1 FOR SHARE OF b`,
    [id],
  );
  const b = rows[0];
  if (!b || b.status !== "confirmed") return;
  const when = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: b.timezone,
  }).format(new Date(b.starts_at));
  const links = `\nManage or reschedule: ${appOrigin()}/reschedule#token=${b.cancel_token}\nTimes shown in ${b.timezone}.`;
  // Fan-out through the unified notification engine. Email still uses delivery_jobs;
  // SMS stays gated; push is a stub until FCM. Confirmation email remains on the
  // legacy email_outbox → delivery_jobs bridge to avoid duplicate Resend sends.
  const { enqueueNotification } = await import("./notifications/engine");
  const phone = (b.guest_phone as string) || "";
  const reminderText = `Your appointment: ${b.title}\n${when} (${b.timezone})${links}`;
  const offsets: number[] = [...new Set(b.reminder_minutes as number[])];
  for (const minutes of offsets) {
    const at = new Date(new Date(b.starts_at).getTime() - minutes * 60000);
    if (at.getTime() <= Date.now()) continue;
    const emailKey = `reminder:${b.id}:${b.revision}:${minutes}`;
    const reminderChannels = ["email", "push", ...(phone ? (["sms"] as const) : [])] as (
      | "email"
      | "sms"
      | "push"
    )[];
    await enqueueNotification(db, {
      workspaceId: b.user_id,
      idempotencyKey: `notify:${emailKey}`,
      category: "appointment_reminder",
      templateId: "appointment_reminder",
      channels: reminderChannels,
      recipientAddress: b.guest_email,
      recipientContactId: b.contact_id,
      bookingId: b.id,
      bookingRevision: b.revision,
      scheduledAt: at,
      email: {
        kind: "booking_reminder",
        key: emailKey,
        to: b.guest_email,
        subject: "Reminder: " + b.title,
        text: reminderText,
        at,
        expires: new Date(b.starts_at),
      },
      sms: phone
        ? {
            to: phone,
            body: `Reminder: ${b.title} on ${when}. Manage: ${appOrigin()}/reschedule#token=${b.cancel_token}`,
            // Match launch SMS reminder refs; bookingId lets drainSmsOutbox skip message-UUID origin checks.
            reference: `reminder:${b.id}:${b.revision}:${minutes}`,
            bookingId: b.id,
            bookingRevision: b.revision,
          }
        : undefined,
      push: {
        title: "Appointment reminder",
        body: `${b.title} · ${when}`,
      },
    });
  }
  // Host field edits refresh reminders only — never re-send confirmation or "moved" mail.
  if (options?.skipChangeEmails) return;

  if (b.revision > 0) {
    const changedText = `Your appointment has moved to ${when} (${b.timezone}).${links}`;
    for (const to of [b.guest_email, b.host_email]) {
      const emailKey = `changed:${b.id}:${b.revision}:${to}`;
      const guestSms = to === b.guest_email && phone;
      const channels = [
        "email" as const,
        "push" as const,
        ...(guestSms ? (["sms"] as const) : []),
      ];
      await enqueueNotification(db, {
        workspaceId: b.user_id,
        idempotencyKey: `notify:${emailKey}`,
        category: "appointment_reschedule",
        templateId: "appointment_reschedule",
        channels,
        recipientAddress: to,
        recipientContactId: to === b.guest_email ? b.contact_id : null,
        bookingId: b.id,
        bookingRevision: b.revision,
        email: {
          kind: "booking_changed",
          key: emailKey,
          to,
          subject: "Appointment rescheduled: " + b.title,
          text: changedText,
          expires: new Date(b.starts_at),
        },
        sms: guestSms
          ? {
              to: phone,
              body: `Rescheduled: ${b.title} is now ${when}. Manage: ${appOrigin()}/reschedule#token=${b.cancel_token}`,
              reference: `changed:${b.id}:${b.revision}`,
              bookingId: b.id,
              bookingRevision: b.revision,
            }
          : undefined,
        push: {
          title: "Appointment rescheduled",
          body: `${b.title} · ${when}`,
        },
      });
    }
    return;
  }

  // Confirmation: SMS + push only (email confirmation still from email_outbox bridge).
  // revision === 0 means the booking has never been moved / field-bumped.
  const confirmChannels = ["push", ...(phone ? (["sms"] as const) : [])] as ("sms" | "push")[];
  await enqueueNotification(db, {
    workspaceId: b.user_id,
    idempotencyKey: `notify:confirm:${b.id}:${b.revision}`,
    category: "appointment_confirmation",
    templateId: "appointment_confirmation",
    channels: confirmChannels,
    recipientAddress: b.guest_email,
    recipientContactId: b.contact_id,
    bookingId: b.id,
    bookingRevision: b.revision,
    sms: phone
      ? {
          to: phone,
          body: `Confirmed: ${b.title} on ${when}. Manage: ${appOrigin()}/reschedule#token=${b.cancel_token}`,
          reference: `confirm:${b.id}:${b.revision}`,
          bookingId: b.id,
          bookingRevision: b.revision,
        }
      : undefined,
    push: {
      title: "Appointment confirmed",
      body: `${b.title} · ${when}`,
    },
  });
}
export async function materializeReminders(user?: string) {
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    // Exclude bookings whose reminder envelopes already exist (including intentionally
    // suppressed ones) so LIMIT 500 is not starved by missing delivery_jobs rows.
    // Failed envelopes stay eligible; envelopes with a retryable failed SMS also stay
    // eligible even when the email delivery_job already exists.
    const { rows } = await db.query(
      `SELECT b.id FROM public.bookings b
         JOIN public.event_types e ON e.id=b.event_id
        WHERE b.status='confirmed'
          AND b.starts_at>now()
          AND b.starts_at<now()+interval '91 days'
          ${user ? "AND b.user_id=$1" : ""}
          AND EXISTS(
            SELECT 1 FROM unnest(e.reminder_minutes) m
             WHERE b.starts_at-make_interval(mins=>m)>now()
               AND (
                 (
                   NOT EXISTS(
                     SELECT 1 FROM private.delivery_jobs j
                      WHERE j.dedupe_key='reminder:'||b.id||':'||b.revision||':'||m
                   )
                   AND NOT EXISTS(
                     SELECT 1 FROM private.notifications n
                      WHERE n.workspace_id=b.user_id
                        AND n.idempotency_key='notify:reminder:'||b.id||':'||b.revision||':'||m
                        AND n.status IN ('queued','scheduled','processing','accepted','delivered','suppressed','canceled')
                   )
                 )
                 OR EXISTS(
                   SELECT 1
                     FROM private.notifications n
                     JOIN private.notification_attempts a ON a.notification_id=n.id
                    WHERE n.workspace_id=b.user_id
                      AND n.idempotency_key='notify:reminder:'||b.id||':'||b.revision||':'||m
                      AND a.channel='sms'
                      AND (
                        (a.status='failed' AND (a.failure_class IS NULL OR a.failure_class='transient'))
                        OR (a.status='scheduled' AND n.scheduled_at<=now())
                      )
                 )
               )
          )
        ORDER BY b.starts_at
        LIMIT 500`,
      user ? [user] : [],
    );
    // Reminder materialization must never enqueue "appointment moved" emails.
    for (const r of rows) await scheduleBooking(db, r.id, { skipChangeEmails: true });
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export async function drainDeliveries(user?: string, limit = 10, earlyAccess?: string) {
  const [key, from, bookingFrom] = await Promise.all([
    integrationValue("RESEND_API_KEY"),
    integrationValue("AUTH_EMAIL_FROM"),
    integrationValue("BOOKING_EMAIL_FROM"),
  ]);
  if (!key.trim() || !from.trim() || !process.env.INTEGRATION_ENCRYPTION_KEY)
    return { sent: 0, configured: false };
  let sent = 0;
  for (let i = 0; i < Math.min(limit, 20); i++) {
    const db = await getPool().connect();
    try {
      const { rows } = await db.query(
        `SELECT * FROM private.delivery_jobs WHERE status='queued' AND run_at<=now() ${user ? "AND user_id=$1" : earlyAccess ? "AND early_access_id=$1" : ""} ORDER BY run_at LIMIT 1`,
        user ? [user] : earlyAccess ? [earlyAccess] : [],
      );
      const j = rows[0];
      if (!j) break;
      // Persist the first attempt before contacting the provider. A rollback after an
      // accepted send must not erase the start of its provider idempotency window.
      const claim = await db.query(
        "UPDATE private.delivery_jobs SET claimed_at=coalesce(claimed_at,now()),sender=coalesce(sender,$2) WHERE id=$1 AND status='queued' RETURNING claimed_at,sender",
        [j.id, j.attempts > 0 ? from.trim() : deliverySender(j.kind, from, bookingFrom)],
      );
      if (!claim.rowCount) continue;
      j.claimed_at = claim.rows[0]?.claimed_at || j.claimed_at || new Date();
      j.sender = claim.rows[0]?.sender || j.sender || from.trim();
      await db.query("BEGIN");
      // Lock the source before the job, matching signing and rescheduling transactions.
      if (j.booking_id)
        await db.query("SELECT id FROM public.bookings WHERE id=$1 FOR SHARE", [
          j.booking_id,
        ]);
      if (j.envelope_id)
        await db.query(
          "SELECT id FROM private.signature_envelopes WHERE id=$1 FOR SHARE",
          [j.envelope_id],
        );
      if (j.document_id)
        await db.query(
          "SELECT id FROM private.signing_documents WHERE id=$1 FOR SHARE",
          [j.document_id],
        );
      const teamInviteValid = j.kind !== "team_invite" || !!(await db.query(
        "SELECT 1 FROM private.team_invites WHERE id=$1 AND email=$2 AND accepted_at IS NULL AND expires_at>now() FOR SHARE",
        [j.dedupe_key.slice("team-invite:".length), j.recipient],
      )).rowCount;
      let earlyAccessExists = true;
      if (j.early_access_id)
        earlyAccessExists = !!(await db.query(
          "SELECT id FROM private.early_access_signups WHERE id=$1 FOR SHARE", [j.early_access_id],
        )).rowCount;
      const lockedJob = (
        await db.query(
          "SELECT * FROM private.delivery_jobs WHERE id=$1 AND status='queued' FOR UPDATE SKIP LOCKED",
          [j.id],
        )
      ).rows[0];
      if (!lockedJob) {
        await db.query("COMMIT");
        continue;
      }
      // Prefer the locked row — an edit may have advanced booking_revision / cancelled while we waited.
      Object.assign(j, lockedJob, {
        claimed_at: j.claimed_at || lockedJob.claimed_at,
        sender: j.sender || lockedJob.sender,
      });
      let valid =
        teamInviteValid &&
        earlyAccessExists &&
        new Date(j.expires_at).getTime() > Date.now();
      if (j.booking_id) {
        const b = (
          await db.query(
            "SELECT b.status,b.revision,b.starts_at,e.reminder_minutes FROM public.bookings b JOIN public.event_types e ON e.id=b.event_id WHERE b.id=$1 FOR SHARE OF b",
            [j.booking_id],
          )
        ).rows[0];
        valid &&=
          !!b &&
          (j.kind === "booking_cancelled"
            ? b.status === "cancelled"
            : b.status === "confirmed") &&
          b.revision === j.booking_revision &&
          (j.kind === "workflow_after_appointment" ||
            j.kind === "booking_cancelled" ||
            new Date(b.starts_at).getTime() > Date.now());
        if (j.kind === "booking_reminder")
          valid &&= b?.reminder_minutes?.includes(
            Number(j.dedupe_key.split(":").at(-1)),
          );
      }
      if (j.workflow_rule_id)
        valid &&= !!(
          await db.query(
            "SELECT 1 FROM private.workflow_rules WHERE id=$1 AND enabled",
            [j.workflow_rule_id],
          )
        ).rowCount;
      if(j.waitlist_offer_id) valid &&= !!(await db.query("select 1 from private.waitlist_offers o join private.appointment_waitlists w on w.id=o.waitlist_id where o.id=$1 and o.state='offered' and o.expires_at>now() and w.state='offered' and w.email_opt_in",[j.waitlist_offer_id])).rowCount;
      if (j.envelope_id && j.kind !== "document_complete") {
        const e = (
          await db.query(
            "SELECT e.status,e.expires_at,r.status recipient_status,(e.signing_mode='sequential' AND EXISTS(SELECT 1 FROM private.signature_recipients p WHERE p.envelope_id=e.id AND p.signing_order<r.signing_order AND p.status<>'signed')) routing_blocked FROM private.signature_envelopes e LEFT JOIN private.signature_recipients r ON r.id=$2 WHERE e.id=$1 FOR SHARE OF e",
            [j.envelope_id, j.recipient_id],
          )
        ).rows[0];
        valid &&=
          !!e &&
          e.status === "sent" &&
          !e.routing_blocked &&
          e.recipient_status !== "signed" &&
          new Date(e.expires_at).getTime() > Date.now();
      }
      if (j.document_id && j.kind !== "document_complete") {
        const d = (
          await db.query(
            "SELECT status,expires_at FROM private.signing_documents WHERE id=$1 FOR SHARE",
            [j.document_id],
          )
        ).rows[0];
        valid &&=
          !!d &&
          d.status === "awaiting_signature" &&
          new Date(d.expires_at).getTime() > Date.now();
      }
      if (!valid) {
        await db.query(
          "UPDATE private.delivery_jobs SET status='cancelled',payload_ciphertext=NULL,calendar_ciphertext=NULL WHERE id=$1",
          [j.id],
        );
        await syncNotificationAttemptFromDeliveryJob(db, {
          id: j.id,
          notification_attempt_id: j.notification_attempt_id,
          status: "cancelled",
          last_error: "Delivery cancelled because the source record is no longer valid.",
        });
        await db.query("COMMIT");
        continue;
      }
      const suppressed = await db.query(
        "select 1 from private.email_suppressions where email_hash=$1",
        [createHash("sha256").update(String(j.recipient).trim().toLowerCase()).digest("hex")],
      );
      if (suppressed.rowCount) {
        await db.query(
          "UPDATE private.delivery_jobs SET status='failed',provider_status='suppressed',payload_ciphertext=NULL,calendar_ciphertext=NULL,last_error='Email delivery is suppressed after a provider complaint or bounce.' WHERE id=$1",
          [j.id],
        );
        await syncNotificationAttemptFromDeliveryJob(db, {
          id: j.id,
          notification_attempt_id: j.notification_attempt_id,
          status: "failed",
          last_error: "Email delivery is suppressed after a provider complaint or bounce.",
        });
        await db.query("COMMIT");
        continue;
      }
      if (
        j.claimed_at &&
        Date.now() - new Date(j.claimed_at).getTime() > 23 * 3600000
      ) {
        await db.query(
          "UPDATE private.delivery_jobs SET status='uncertain',last_error='Delivery confirmation timed out. Check whether the message arrived before sending again.' WHERE id=$1",
          [j.id],
        );
        await syncNotificationAttemptFromDeliveryJob(db, {
          id: j.id,
          notification_attempt_id: j.notification_attempt_id,
          status: "uncertain",
          last_error: "Delivery confirmation timed out. Check whether the message arrived before sending again.",
        });
        await db.query("COMMIT");
        continue;
      }
      if(process.env.PRICING_V3_VALIDATED === "true") {
        const {reserveEmail}=await import("./email-usage");
        try{await reserveEmail(db,{user:j.user_id,reference:"delivery:"+j.id,kind:j.kind,recipient:j.recipient});}
        catch(error){
          if(error instanceof ApiError && [409,429].includes(error.status)){
            await db.query("UPDATE private.delivery_jobs SET run_at=now()+interval '1 hour',claimed_at=CASE WHEN attempts=0 THEN NULL ELSE claimed_at END,last_error=$2 WHERE id=$1",[j.id,error.message]);
            await db.query("COMMIT");continue;
          }
          throw error;
        }
      }
      await db.query(
        "UPDATE private.delivery_jobs SET claimed_at=coalesce(claimed_at,now()),attempts=attempts+1 WHERE id=$1",
        [j.id],
      );
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + key.trim(),
            "Content-Type": "application/json",
            "Idempotency-Key": "zenvio-delivery-" + j.id,
          },
          body: JSON.stringify({
            from: j.sender,
            ...(j.reply_to?{reply_to:j.reply_to}:{}),
            to: j.recipient,
            subject: j.subject,
            ...(j.calendar_ciphertext ? { attachments: [{ filename: "appointment.ics", content: Buffer.from(unsealSecret(j.calendar_ciphertext)).toString("base64"), content_type: "text/calendar; charset=utf-8" }] } : {}),
            text: unsealSecret(j.payload_ciphertext),
            ...(j.kind === "customer_message" ? {} : { html: transactionalEmail(j.subject, unsealSecret(j.payload_ciphertext)) }),
          }),
          signal: AbortSignal.timeout(8000),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.id)
          throw resendFailure(response.status, data);
        await db.query(
          "UPDATE private.delivery_jobs SET status='sent',sent_at=now(),provider_id=$2,provider_status='accepted',payload_ciphertext=NULL,calendar_ciphertext=NULL,last_error=NULL WHERE id=$1",
          [j.id, data.id],
        );
        await syncNotificationAttemptFromDeliveryJob(db, {
          id: j.id,
          notification_attempt_id: j.notification_attempt_id,
          status: "sent",
          provider_id: data.id,
        });
        if(process.env.PRICING_V3_VALIDATED === "true"){
          const {acceptEmail}=await import("./email-usage");await acceptEmail(db,"delivery:"+j.id,data.id);
        }
        sent++;
      } catch (error) {
        const failure =
          error instanceof ResendDeliveryError
            ? error
            : new ResendDeliveryError(
                "network_failure",
                "Email delivery could not be confirmed. A retry uses the same provider key.",
                true,
              );
        const failed = await db.query(
          "UPDATE private.delivery_jobs SET status=CASE WHEN $2='idempotency_conflict' THEN 'uncertain' WHEN NOT $4 OR attempts>=5 THEN 'failed' ELSE 'queued' END,run_at=now()+interval '5 minutes',provider_status=$2,last_error=$3 WHERE id=$1 RETURNING status",
          [j.id, failure.code, failure.message, failure.retryable],
        );
        await syncNotificationAttemptFromDeliveryJob(db, {
          id: j.id,
          notification_attempt_id: j.notification_attempt_id,
          status: failed.rows[0]?.status || "failed",
          last_error: failure.message,
        });
      }
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
  return { sent, configured: true };
}
export function reminderOffsets(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length > 3 ||
    value.some((v) => !Number.isInteger(v) || v < 15 || v > 10080)
  )
    throw new ApiError(
      "Choose up to three reminders, between 15 minutes and seven days.",
    );
  return [...new Set(value)].sort((a, b) => b - a);
}
export async function purgeExpiredDeliverySecrets() {
  const db = getPool();
  await db.query(
    "UPDATE private.delivery_jobs SET payload_ciphertext=NULL,calendar_ciphertext=NULL,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END WHERE expires_at<now() AND payload_ciphertext IS NOT NULL",
  );
  await db.query(
    "UPDATE private.signature_recipients r SET link_ciphertext=NULL FROM private.signature_envelopes e WHERE e.id=r.envelope_id AND (e.status IN ('voided','declined') OR (e.status<>'completed' AND e.expires_at<now()) OR e.completed_at<now()-interval '30 days')",
  );
  await db.query(
    "UPDATE private.signing_documents SET link_ciphertext=NULL WHERE status='voided' OR (status='awaiting_signature' AND expires_at<now()) OR signed_at<now()-interval '30 days'",
  );
}
