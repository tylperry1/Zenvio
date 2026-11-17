"use client";
import { useEffect, useMemo, useState } from "react";
import { TimezoneSelect } from "./timezone-select";
import { AddressAutocomplete } from "./address-autocomplete";
import { localBookingStart } from "@/lib/recurrence.mjs";
import { Modal } from "./modal";
import type { WorkspaceData } from "@/lib/types";
import {
  emptyAddress,
  isLocationMode,
  locationLabel,
  type LocationMode,
  type StructuredAddress,
} from "@/lib/addresses";

export function CreateAppointment({
  data,
  busy,
  onClose,
  onSave,
  initialContact,
}: {
  initialContact?: string;
  data: WorkspaceData;
  busy: boolean;
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => Promise<boolean>;
}) {
  const events = data.events.filter((e) => e.active && !e.deleted_at);
  const [override, setOverride] = useState(false);
  const [manualTime, setManualTime] = useState("");
  const [zone, setZone] = useState(data.profile.timezone);
  const [eventId, setEventId] = useState(events[0]?.id || "");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const initial = data.contacts.find((c) => c.id === initialContact);
  const [name, setName] = useState(initial?.name || ""),
    [email, setEmail] = useState(initial?.email || ""),
    [phone, setPhone] = useState(initial?.phone || "");
  const event = events.find((e) => e.id === eventId);
  const allowedModes = useMemo(() => {
    const modes = (event?.allowed_location_modes?.length
      ? event.allowed_location_modes
      : [event?.location_mode || "custom"]) as LocationMode[];
    return modes.filter(isLocationMode);
  }, [event]);
  const [locationMode, setLocationMode] = useState<LocationMode>("custom");
  const [serviceAddress, setServiceAddress] = useState<StructuredAddress>(emptyAddress());
  const [accessInstructions, setAccessInstructions] = useState("");
  const [virtualMeetingLink, setVirtualMeetingLink] = useState("");

  useEffect(() => {
    const next = (
      allowedModes.includes(event?.location_mode as LocationMode)
        ? event?.location_mode
        : allowedModes[0] || "custom"
    ) as LocationMode;
    setLocationMode(next);
    setServiceAddress(emptyAddress());
    setAccessInstructions("");
    setVirtualMeetingLink(event?.location || "");
  }, [eventId, allowedModes, event?.location_mode, event?.location]);

  useEffect(() => {
    setSlots([]);
    setStart("");
    setError("");
    if (!date || !event || override) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    fetch(
      `/api/book?${new URLSearchParams({ host: data.profile.slug, event: event.slug, date })}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Unable to load times.");
        return d;
      })
      .then((d) => setSlots(d.slots))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [date, event?.slug, data.profile.slug, override]);

  const needsGuestAddress = locationMode === "at_customer" || locationMode === "custom";
  const business = data.businessAddress;

  return (
    <Modal title="Create appointment" onClose={onClose}>
      <form
        className="stack-form appointment-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || loading) return;
          let chosen = start;
          try {
            if (override) chosen = localBookingStart(`${date}T${manualTime}`, zone);
          } catch (error) {
            setError((error as Error).message);
            return;
          }
          if (!chosen) {
            setError(
              "Choose a valid time. This local time may not exist because of daylight saving time.",
            );
            return;
          }
          const f = new FormData(e.currentTarget);
          const success = await onSave({
            event_id: eventId,
            starts_at: chosen,
            overrideAvailability: override,
            overrideConfirmed: f.get("overrideConfirmed") === "on",
            overrideReason: f.get("overrideReason"),
            name,
            email,
            answers: Object.fromEntries(
              (event?.intake_questions || []).map((q) => [
                q.id,
                q.type === "checkbox"
                  ? f.get("intake_" + q.id) === "on"
                  : q.type === "multiple_choice"
                    ? f.getAll("intake_" + q.id)
                    : f.get("intake_" + q.id),
              ]),
            ),
            locationMode,
            serviceAddress: needsGuestAddress ? serviceAddress : undefined,
            accessInstructions:
              locationMode === "at_customer" || locationMode === "custom"
                ? accessInstructions || serviceAddress.accessInstructions
                : undefined,
            location:
              locationMode === "at_business"
                ? business?.formatted || event?.location || ""
                : locationMode === "virtual"
                  ? virtualMeetingLink.trim() || event?.location || "Virtual meeting"
                  : serviceAddress.formatted || event?.location || "",
            phone,
            company: f.get("company"),
            purpose: f.get("purpose"),
            notes: f.get("notes"),
          });
          if (!success)
            setError(
              "Appointment could not be created. Check the notification and choose another time if needed.",
            );
        }}
      >
        <p>
          Schedule on behalf of a client. Published availability follows{" "}
          {data.profile.timezone.replaceAll("_", " ")}; displayed times use your selected time
          zone. A manual override can bypass published hours while calendar conflicts and buffers
          remain protected.
        </p>
        {!events.length && (
          <p role="status">Create an active appointment type before adding an appointment.</p>
        )}
        <label>
          Appointment type
          <select
            required
            value={eventId}
            disabled={busy}
            onChange={(e) => setEventId(e.target.value)}
          >
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title} · {e.duration} min
              </option>
            ))}
          </select>
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={override}
            disabled={busy}
            onChange={(e) => setOverride(e.target.checked)}
          />
          Enter a custom time outside availability
        </label>
        <label>
          Time zone
          <TimezoneSelect
            value={zone}
            onChange={setZone}
            businessZone={data.profile.timezone}
            disabled={busy}
          />
        </label>
        <label>
          {override
            ? "Appointment date in selected time zone"
            : `Availability date (${data.profile.timezone})`}
          <input
            type="date"
            required
            value={date}
            disabled={busy || !events.length}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        {!override && (
          <label>
            Available time
            <select
              required
              value={start}
              disabled={busy || loading || !slots.length}
              onChange={(e) => setStart(e.target.value)}
            >
              <option value="">{loading ? "Loading times…" : "Choose a time"}</option>
              {slots.map((s) => (
                <option key={s} value={s}>
                  {new Date(s).toLocaleTimeString([], {
                    timeZone: zone,
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </option>
              ))}
            </select>
          </label>
        )}
        {override && (
          <>
            <label>
              Custom time
              <input
                type="time"
                required
                value={manualTime}
                onChange={(e) => setManualTime(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              Reason for override
              <input
                name="overrideReason"
                required
                minLength={5}
                maxLength={500}
                placeholder="e.g. Client requested an evening appointment"
                disabled={busy}
              />
            </label>
            <label className="check-label">
              <input name="overrideConfirmed" type="checkbox" required disabled={busy} />I confirm
              this time may be outside published availability. Calendar conflicts will still be
              checked.
            </label>
          </>
        )}
        {!override && date && event && !loading && !slots.length && !error && (
          <p role="status">
            No available times. Choose another date, adjust your booking rules, or enter a custom
            time.
          </p>
        )}
        {!!data.contacts.length && (
          <label>
            Use an existing contact
            <select
              defaultValue=""
              disabled={busy}
              onChange={(e) => {
                const c = data.contacts.find((c) => c.id === e.target.value);
                if (c) {
                  setName(c.name);
                  setEmail(c.email);
                  setPhone(c.phone || "");
                }
              }}
            >
              <option value="">Enter a new client below</option>
              {data.contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.email}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Client name
          <input
            required
            minLength={2}
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          Client email
          <input
            type="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          Telephone
          <input
            name="phone"
            type="tel"
            required
            maxLength={40}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={busy}
            placeholder="+1 555 555 0100"
          />
        </label>
        {event?.intake_questions?.map((q) => (
          <label key={q.id}>
            {q.label}
            {q.required ? " *" : ""}
            {q.type === "checkbox" ? (
              <input name={"intake_" + q.id} type="checkbox" required={q.required} />
            ) : q.type === "long_text" ? (
              <textarea name={"intake_" + q.id} required={q.required} maxLength={2000} />
            ) : q.type === "single_choice" ? (
              <select name={"intake_" + q.id} required={q.required}>
                <option value="">Choose…</option>
                {q.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : q.type === "multiple_choice" ? (
              <span>
                {q.options.map((o) => (
                  <label key={o}>
                    <input name={"intake_" + q.id} type="checkbox" value={o} />
                    {o}
                  </label>
                ))}
              </span>
            ) : (
              <input name={"intake_" + q.id} required={q.required} maxLength={200} />
            )}
          </label>
        ))}
        {allowedModes.length > 1 ? (
          <fieldset>
            <legend>Appointment location</legend>
            {allowedModes.map((mode) => (
              <label key={mode} className="check-label">
                <input
                  type="radio"
                  name="locationMode"
                  checked={locationMode === mode}
                  disabled={busy}
                  onChange={() => setLocationMode(mode)}
                />
                {locationLabel(mode, event?.location || "")}
              </label>
            ))}
          </fieldset>
        ) : (
          <p role="status">Location: {locationLabel(locationMode, event?.location || "")}</p>
        )}
        {locationMode === "at_business" && (
          <p style={{ whiteSpace: "pre-line" }}>
            {business?.formatted ||
              event?.location ||
              "Add your business address in Business Profile to show it here."}
          </p>
        )}
        {locationMode === "virtual" && (
          <>
            {event?.virtual_instructions ? (
              <p style={{ whiteSpace: "pre-line" }}>{event.virtual_instructions}</p>
            ) : null}
            <label>
              Meeting link for this appointment
              <input
                value={virtualMeetingLink}
                onChange={(e) => setVirtualMeetingLink(e.target.value)}
                maxLength={500}
                disabled={busy}
                placeholder="https://meet.example.com/… or dial-in details"
              />
              <small>Overrides the appointment type location for this booking only.</small>
            </label>
          </>
        )}
        {needsGuestAddress && (
          <>
            <AddressAutocomplete
              host={data.profile.slug}
              value={serviceAddress}
              onChange={setServiceAddress}
              required={locationMode === "at_customer"}
              label={
                locationMode === "at_customer" ? "Customer service address" : "Meeting address"
              }
              disabled={busy}
            />
            <label>
              Access instructions
              <textarea
                maxLength={1000}
                rows={2}
                value={accessInstructions}
                onChange={(e) => setAccessInstructions(e.target.value)}
                disabled={busy}
                placeholder="Gate code, parking, suite entry…"
              />
            </label>
          </>
        )}
        <label>
          Company
          <input name="company" maxLength={100} disabled={busy} />
        </label>
        <label>
          Meeting purpose
          <input name="purpose" maxLength={500} disabled={busy} />
        </label>
        <label>
          Notes
          <textarea name="notes" maxLength={2000} rows={3} disabled={busy} />
        </label>
        <p>
          Confirmation emails are queued when email delivery is configured. Connected calendar sync
          runs after creation.
        </p>
        {error && <p role="alert">{error}</p>}
        <button
          className="button primary full"
          disabled={busy || loading || (override ? !date || !manualTime : !start)}
        >
          {busy ? "Creating…" : "Create appointment"}
        </button>
      </form>
    </Modal>
  );
}
