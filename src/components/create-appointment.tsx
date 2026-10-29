"use client";
import { useEffect, useState } from "react";
import { Modal } from "./modal";
import type { WorkspaceData } from "@/lib/types";

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
  const [eventId, setEventId] = useState(events[0]?.id || "");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState(
      data.contacts.find((c) => c.id === initialContact)?.name || "",
    ),
    [email, setEmail] = useState(
      data.contacts.find((c) => c.id === initialContact)?.email || "",
    );
  const event = events.find((e) => e.id === eventId);
  useEffect(() => {
    setSlots([]);
    setStart("");
    setError("");
    if (!date || !event) return;
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
  }, [date, event?.slug, data.profile.slug]);
  return (
    <Modal title="Create appointment" onClose={onClose}>
      <form
        className="stack-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!start || busy || loading) return;
          const f = new FormData(e.currentTarget);
          const success = await onSave({
            event_id: eventId,
            starts_at: start,
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
            phone: f.get("phone"),
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
          Schedule on behalf of a client. Times use{" "}
          {data.profile.timezone.replaceAll("_", " ")} and respect your
          availability, buffers, and connected calendar.
        </p>
        {!events.length && (
          <p role="status">
            Create an active appointment type before adding an appointment.
          </p>
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
        <label>
          Date
          <input
            type="date"
            required
            value={date}
            disabled={busy || !events.length}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          Available time
          <select
            required
            value={start}
            disabled={busy || loading || !slots.length}
            onChange={(e) => setStart(e.target.value)}
          >
            <option value="">
              {loading ? "Loading times…" : "Choose a time"}
            </option>
            {slots.map((s) => (
              <option key={s} value={s}>
                {new Date(s).toLocaleTimeString([], {
                  timeZone: data.profile.timezone,
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </option>
            ))}
          </select>
        </label>
        {date && event && !loading && !slots.length && !error && (
          <p role="status">
            No available times. Choose another date. Booking times are 2 hours
            to 90 days ahead.
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
        {event?.intake_questions?.map((q) => (
          <label key={q.id}>
            {q.label}
            {q.required ? " *" : ""}
            {q.type === "checkbox" ? (
              <input
                name={"intake_" + q.id}
                type="checkbox"
                required={q.required}
              />
            ) : q.type === "long_text" ? (
              <textarea
                name={"intake_" + q.id}
                required={q.required}
                maxLength={2000}
              />
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
              <input
                name={"intake_" + q.id}
                required={q.required}
                maxLength={200}
              />
            )}
          </label>
        ))}
        <label>
          Phone
          <input name="phone" type="tel" maxLength={40} disabled={busy} />
        </label>
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
          Confirmation emails are queued when email delivery is configured.
          Connected calendar sync runs after creation.
        </p>
        {error && <p role="alert">{error}</p>}
        <button
          className="button primary full"
          disabled={busy || loading || !start}
        >
          {busy ? "Creating…" : "Create appointment"}
        </button>
      </form>
    </Modal>
  );
}
