"use client";

import { useEffect, useState } from "react";
import {
  bookingLocationSummary,
  emptyAddress,
  LOCATION_MODES,
  locationLabel,
  type LocationMode,
  type StructuredAddress,
} from "@/lib/addresses";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { localBookingStart } from "@/lib/recurrence.mjs";
import { inZone } from "@/lib/scheduling.mjs";
import { AddressAutocomplete } from "./address-autocomplete";
import { Badge, Field, FormActions, Notice, Panel, Timeline } from "./ds";
import { Icon } from "./icons";
import { Modal } from "./modal";

/** Format an instant as `YYYY-MM-DDTHH:mm` in the booking timezone for datetime-local. */
function toLocalInput(value: string | Date, timeZone: string) {
  const p = inZone(new Date(value), timeZone || "UTC");
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

type DetailPayload = {
  booking: {
    id: string;
    event_id: string;
    guest_name: string;
    guest_email: string;
    guest_phone?: string;
    guest_company?: string;
    meeting_purpose?: string;
    notes?: string;
    location?: string;
    location_mode?: LocationMode | null;
    service_address?: StructuredAddress | null;
    access_instructions?: string;
    starts_at: string;
    ends_at: string;
    status: string;
    title?: string;
    timezone?: string;
    slug?: string;
    allowed_location_modes?: string[] | null;
    virtual_instructions?: string;
  };
  history: { id: string; action: string; details: Record<string, unknown>; created_at: string }[];
  notifications: {
    id: string;
    category: string;
    template_id: string;
    status: string;
    recipient_address: string;
    created_at: string;
    attempts?: { channel: string; status: string; failureReason?: string }[];
  }[];
};

function mapsUrl(address?: StructuredAddress | null, fallback = "") {
  const q = address?.formatted || fallback;
  return q ? `https://maps.google.com/?q=${encodeURIComponent(q)}` : "";
}

function modeOptions(allowed?: string[] | null): LocationMode[] {
  const list = (allowed?.length ? allowed : [...LOCATION_MODES]).filter((m): m is LocationMode =>
    (LOCATION_MODES as readonly string[]).includes(m),
  );
  return list.length ? list : [...LOCATION_MODES];
}

export function AppointmentDetailModal({
  bookingId,
  hostSlug,
  onClose,
  onChanged,
}: {
  bookingId: string;
  hostSlug: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<DetailPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [form, setForm] = useState({
    guestName: "",
    guestEmail: "",
    guestPhone: "",
    guestCompany: "",
    meetingPurpose: "",
    notes: "",
    startsAt: "",
    endsAt: "",
    locationMode: "custom" as LocationMode,
    serviceAddress: emptyAddress(),
    accessInstructions: "",
  });

  async function load() {
    setError("");
    const r = await fetch(`/api/bookings/edit?id=${encodeURIComponent(bookingId)}`, {
      cache: "no-store",
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Unable to load appointment.");
    setData(d);
    const b = d.booking;
    const zone = b.timezone || "UTC";
    setForm({
      guestName: b.guest_name || "",
      guestEmail: b.guest_email || "",
      guestPhone: b.guest_phone || "",
      guestCompany: b.guest_company || "",
      meetingPurpose: b.meeting_purpose || "",
      notes: b.notes || "",
      startsAt: toLocalInput(b.starts_at, zone),
      endsAt: toLocalInput(b.ends_at, zone),
      locationMode: (b.location_mode as LocationMode) || "custom",
      serviceAddress: b.service_address || emptyAddress(),
      accessInstructions: b.access_instructions || "",
    });
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Unable to load appointment."));
  }, [bookingId]);

  async function save(extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    try {
      const zone = data?.booking?.timezone || "UTC";
      const original = data?.booking;
      const body: Record<string, unknown> = {
        id: bookingId,
        guestName: form.guestName,
        guestEmail: form.guestEmail,
        guestPhone: form.guestPhone,
        guestCompany: form.guestCompany,
        meetingPurpose: form.meetingPurpose,
        notes: form.notes,
        ...extra,
      };
      // Only send location fields when they differ — avoids phantom revision bumps.
      const locationChanged =
        form.locationMode !== ((original?.location_mode as LocationMode) || "custom") ||
        (form.accessInstructions || "") !== (original?.access_instructions || "") ||
        ((form.locationMode === "at_customer" || form.locationMode === "custom") &&
          (form.serviceAddress?.formatted || "") !== (original?.service_address?.formatted || ""));
      if (locationChanged) {
        body.locationMode = form.locationMode;
        body.accessInstructions = form.accessInstructions;
        if (form.locationMode === "at_customer" || form.locationMode === "custom") {
          body.serviceAddress = form.serviceAddress;
        }
      }
      if (rescheduling) {
        body.startsAt = localBookingStart(form.startsAt, zone);
        body.endsAt = localBookingStart(form.endsAt, zone);
      }
      const r = await fetch("/api/bookings/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Unable to save appointment.");
      setEditing(false);
      setRescheduling(false);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save appointment.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelAppointment() {
    if (!confirm("Cancel this appointment? The customer will be notified.")) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/bookings/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: bookingId, status: "cancelled" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Unable to cancel.");
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to cancel.");
    } finally {
      setBusy(false);
    }
  }

  const booking = data?.booking;
  const zone = booking?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const map = mapsUrl(booking?.service_address, booking?.location || "");

  return (
    <Modal title={booking?.title || "Appointment"} onClose={() => !busy && onClose()}>
      {error && <Notice tone="danger">{error}</Notice>}
      {!booking && !error && <p className="ds-muted">Loading appointment…</p>}
      {booking && (
        <div className="ds-stack" style={{ gap: 16 }}>
          <Panel title="Customer">
            <dl className="ds-dl">
              <div>
                <dt>Name</dt>
                <dd>{booking.guest_name}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{booking.guest_email}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{booking.guest_phone ? formatPhoneDisplay(booking.guest_phone) : "—"}</dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Schedule">
            <dl className="ds-dl">
              <div>
                <dt>When</dt>
                <dd>
                  {new Date(booking.starts_at).toLocaleString([], {
                    dateStyle: "full",
                    timeStyle: "short",
                    timeZone: zone,
                  })}
                  {" – "}
                  {new Date(booking.ends_at).toLocaleTimeString([], {
                    timeStyle: "short",
                    timeZone: zone,
                  })}
                </dd>
              </div>
              <div>
                <dt>Timezone</dt>
                <dd>{zone}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <Badge tone={booking.status === "confirmed" ? "success" : "neutral"}>
                    {booking.status}
                  </Badge>
                </dd>
              </div>
            </dl>
          </Panel>

          <Panel
            title="Location"
            actions={
              map ? (
                <a className="ds-btn ghost sm" href={map} target="_blank" rel="noreferrer">
                  Open in Maps <Icon name="arrow" size={14} />
                </a>
              ) : undefined
            }
          >
            {(() => {
              const place = bookingLocationSummary({
                locationMode: booking.location_mode,
                location: booking.location,
                serviceAddress: booking.service_address,
                accessInstructions: booking.access_instructions,
              });
              return (
                <dl className="ds-dl">
                  <div>
                    <dt>Type</dt>
                    <dd>{locationLabel((booking.location_mode as LocationMode) || "custom")}</dd>
                  </div>
                  <div>
                    <dt>Address</dt>
                    <dd style={{ whiteSpace: "pre-line" }}>
                      {place.title || place.body || "Not specified"}
                      {place.body && place.title && place.body !== place.title ? (
                        <span style={{ display: "block" }}>{place.body}</span>
                      ) : null}
                    </dd>
                  </div>
                  <div>
                    <dt>Verified</dt>
                    <dd>
                      {booking.service_address?.validated ? (
                        <Badge tone="success" dot>
                          Smarty verified
                        </Badge>
                      ) : (
                        <Badge tone="neutral">Manual / not verified</Badge>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Instructions</dt>
                    <dd style={{ whiteSpace: "pre-wrap" }}>{place.access || "—"}</dd>
                  </div>
                </dl>
              );
            })()}
          </Panel>

          <Panel title="Appointment">
            <dl className="ds-dl">
              <div>
                <dt>Service</dt>
                <dd>{booking.title}</dd>
              </div>
              <div>
                <dt>Meeting purpose</dt>
                <dd>{booking.meeting_purpose || "—"}</dd>
              </div>
              <div>
                <dt>Internal notes</dt>
                <dd>{booking.notes || "—"}</dd>
              </div>
            </dl>
          </Panel>

          {booking.status === "confirmed" && (
            <FormActions>
              <button type="button" className="ds-btn" disabled={busy} onClick={() => setEditing(true)}>
                Edit appointment
              </button>
              <button
                type="button"
                className="ds-btn ghost"
                disabled={busy}
                onClick={() => {
                  setRescheduling(true);
                  setEditing(true);
                }}
              >
                Reschedule
              </button>
              <button type="button" className="ds-btn ghost" disabled={busy} onClick={() => void cancelAppointment()}>
                Cancel appointment
              </button>
              <a className="ds-btn ghost" href={`/api/bookings?ics=${booking.id}`}>
                Add to calendar
              </a>
            </FormActions>
          )}

          {!!data?.history?.length && (
            <Panel title="History">
              <Timeline
                items={data.history.slice(0, 8).map((h) => ({
                  id: h.id,
                  title: h.action.replaceAll("_", " "),
                  detail: Array.isArray((h.details as { changes?: unknown })?.changes)
                    ? `${((h.details as { changes: unknown[] }).changes || []).length} field(s) changed`
                    : undefined,
                  meta: new Date(h.created_at).toLocaleString(),
                  icon: h.action.includes("location") ? "link" : "clock",
                }))}
              />
            </Panel>
          )}

          {!!data?.notifications?.length && (
            <Panel title="Notification history" description="Visible to authorized workspace users only.">
              <div className="ds-table-wrap">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Recipient</th>
                      <th>Status</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.notifications.map((n) => (
                      <tr key={n.id}>
                        <td>{n.template_id || n.category}</td>
                        <td>{n.recipient_address}</td>
                        <td>
                          <Badge
                            tone={
                              n.status === "delivered" || n.status === "accepted"
                                ? "success"
                                : n.status === "failed"
                                  ? "danger"
                                  : "neutral"
                            }
                          >
                            {n.status}
                          </Badge>
                          {n.attempts?.some((a) => a.failureReason) && (
                            <small className="ds-muted">
                              {n.attempts.find((a) => a.failureReason)?.failureReason}
                            </small>
                          )}
                        </td>
                        <td>{new Date(n.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </div>
      )}

      {editing && booking && (
        <Modal
          title={rescheduling ? "Reschedule appointment" : "Edit appointment"}
          onClose={() => !busy && (setEditing(false), setRescheduling(false))}
        >
          <div className="ds-stack" style={{ gap: 12 }}>
            {error && <Notice tone="danger">{error}</Notice>}
            <Field label="Customer name">
              <input
                value={form.guestName}
                onChange={(e) => setForm((f) => ({ ...f, guestName: e.target.value }))}
                disabled={busy}
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={form.guestEmail}
                onChange={(e) => setForm((f) => ({ ...f, guestEmail: e.target.value }))}
                disabled={busy}
              />
            </Field>
            <Field label="Phone">
              <input
                value={form.guestPhone}
                onChange={(e) => setForm((f) => ({ ...f, guestPhone: e.target.value }))}
                disabled={busy}
              />
            </Field>
            <Field label="Meeting purpose">
              <input
                value={form.meetingPurpose}
                onChange={(e) => setForm((f) => ({ ...f, meetingPurpose: e.target.value }))}
                disabled={busy}
              />
            </Field>
            <Field label="Internal notes">
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                disabled={busy}
                rows={3}
              />
            </Field>

            {rescheduling && (
              <>
                <Field
                  label="Start"
                  hint={`Times in ${(booking.timezone || zone).replaceAll("_", " ")}.`}
                >
                  <input
                    type="datetime-local"
                    value={form.startsAt}
                    onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
                    disabled={busy}
                  />
                </Field>
                <Field label="End">
                  <input
                    type="datetime-local"
                    value={form.endsAt}
                    onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
                    disabled={busy}
                  />
                </Field>
              </>
            )}
            <p className="ds-muted" style={{ margin: 0, fontSize: 13 }}>
              To reassign this appointment to another teammate, use Team → Appointments.
            </p>

            <Field label="Location type">
              <select
                className="ds-select"
                value={form.locationMode}
                onChange={(e) =>
                  setForm((f) => ({ ...f, locationMode: e.target.value as LocationMode }))
                }
                disabled={busy}
              >
                {modeOptions(booking.allowed_location_modes).map((m) => (
                  <option key={m} value={m}>
                    {locationLabel(m)}
                  </option>
                ))}
              </select>
            </Field>

            {(form.locationMode === "at_customer" || form.locationMode === "custom") && (
              <AddressAutocomplete
                host={hostSlug || booking.slug || ""}
                value={form.serviceAddress}
                onChange={(serviceAddress) => setForm((f) => ({ ...f, serviceAddress }))}
                required={form.locationMode === "at_customer"}
                disabled={busy}
                label={form.locationMode === "at_customer" ? "Customer location" : "Meeting address"}
              />
            )}

            {form.locationMode === "virtual" && (
              <Notice tone="info">
                Virtual meetings use the appointment type’s join instructions. No physical address is
                required.
              </Notice>
            )}

            <Field label="Location instructions">
              <textarea
                value={form.accessInstructions}
                onChange={(e) => setForm((f) => ({ ...f, accessInstructions: e.target.value }))}
                disabled={busy || form.locationMode === "at_business"}
                rows={2}
              />
            </Field>

            <FormActions>
              <button type="button" className="ds-btn" disabled={busy} onClick={() => void save()}>
                {busy ? "Saving…" : "Save changes"}
              </button>
              <button
                type="button"
                className="ds-btn ghost"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setRescheduling(false);
                }}
              >
                Back
              </button>
            </FormActions>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
