"use client";
import { useEffect, useState } from "react";
import { SuiteShell } from "./suite-shell";
import { CreateAppointment } from "./create-appointment";
import { Icon } from "./icons";
import { Modal } from "./modal";
import { Alert, Badge, Field, useConfirm } from "./ui";
import { zonedDate, inZone } from "@/lib/scheduling.mjs";
const key = (d: Date, zone: string) => {
  const p = inZone(d, zone);
  return `${p.year}-${p.month}-${p.day}`;
};
const shift = (date: string, n: number) =>
  new Date(Date.parse(date + "T12:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
export function CalendarCenter() {
  const [organizations, setOrganizations] = useState<any[]>([]),
    [organization, setOrganization] = useState(""),
    [staff, setStaff] = useState("all");
  const [zone, setZone] = useState("UTC"),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10)),
    [view, setView] = useState("week"),
    [data, setData] = useState<any>(null),
    [workspace, setWorkspace] = useState<any>(null),
    [account, setAccount] = useState("all"),
    [type, setType] = useState("all"),
    [status, setStatus] = useState("confirmed"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [creating, setCreating] = useState(false),
    [selected, setSelected] = useState<any>(null),
    [message, setMessage] = useState("");
  const { confirm, node: confirmNode } = useConfirm();
  const start = view === "month" ? date.slice(0, 8) + "01" : date,
    days =
      view === "month"
        ? new Date(
            Number(date.slice(0, 4)),
            Number(date.slice(5, 7)),
            0,
          ).getDate()
        : view === "day"
          ? 1
          : 7;
  async function load() {
    const from = zonedDate(start, "00:00", zone),
      to = zonedDate(shift(start, days), "00:00", zone);
    if (!from || !to) return;
    const r = await fetch(
        "/api/calendar?" +
          new URLSearchParams({
            from: from.toISOString(),
            to: to.toISOString(),
            ...(organization ? { organization } : {}),
            ...(account !== "all" && account !== "zenvio" ? { account } : {}),
          }),
      ),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    setData(d);
  }
  useEffect(() => {
    fetch("/api/teams")
      .then((r) => r.json())
      .then((d) => setOrganizations(d.organizations || []))
      .catch(() => {});
    setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (window.innerWidth < 640) setView("day");
    fetch("/api/workspace")
      .then((r) => r.json())
      .then((d) => {
        setWorkspace(d);
        // Show the host's own business hours, not the browser's.
        const home = d?.profile?.timezone;
        if (home) {
          setZone(home);
          const p = inZone(new Date(), home);
          setDate(`${p.year}-${p.month}-${p.day}`);
        }
      });
  }, []);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [date, view, zone, account, organization]);
  const events = (data?.events || []).filter(
    (e: any) =>
      (staff === "all" || e.user_id === staff) &&
      (account === "all" || e.source === account) &&
      (type === "all" || e.event_id === type) &&
      (e.readOnly || status === "all" || e.status === status),
  );
  async function move(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const f = new FormData(event.currentTarget),
        raw = String(f.get("time")).split("T"),
        at = zonedDate(raw[0], raw[1], zone);
      if (!at) throw Error("Choose a valid local time.");
      const r = await fetch("/api/reschedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "move",
            id: selected.id,
            starts_at: at.toISOString(),
          }),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      setSelected(null);
      setMessage("Appointment rescheduled.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <SuiteShell
      title="Calendar"
      description="Your Zenvio appointments alongside busy times from connected calendars."
      actions={
        <button className="ui-btn ui-btn-primary" disabled={!workspace} onClick={() => setCreating(true)}>
          + New appointment
        </button>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}
      <div className="cal-toolbar">
        <div className="cal-nav">
          <button
            className="ui-btn ui-btn-secondary"
            onClick={() => {
              const p = inZone(new Date(), zone);
              setDate(`${p.year}-${p.month}-${p.day}`);
            }}
          >
            Today
          </button>
          <button className="ui-btn ui-btn-ghost ui-btn-icon" onClick={() => setDate(shift(start, -days))} aria-label="Previous period">
            <Icon name="chevron" size={16} style={{ transform: "rotate(180deg)" }} />
          </button>
          <button className="ui-btn ui-btn-ghost ui-btn-icon" onClick={() => setDate(shift(start, days))} aria-label="Next period">
            <Icon name="chevron" size={16} />
          </button>
          <h2 className="cal-range">{rangeLabel(start, days, view)}</h2>
          <input
            className="ui-input cal-date"
            type="date"
            aria-label="Go to date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </div>
        <select className="ui-input cal-view" aria-label="Calendar view" value={view} onChange={(e) => setView(e.target.value)}>
          {["day", "week", "month", "agenda"].map((v) => (
            <option key={v} value={v}>
              {v[0].toUpperCase() + v.slice(1)}
            </option>
          ))}
        </select>
      </div>
      <div className="cal-filters">
        <select className="ui-input" aria-label="Calendar source" value={account} onChange={(e) => setAccount(e.target.value)}>
          <option value="all">All calendars</option>
          <option value="zenvio">Zenvio only</option>
          {data?.accounts.map((a: any) => (
            <option key={a.account_sub} value={a.account_sub}>
              {a.account_email}
            </option>
          ))}
        </select>
        <select className="ui-input" aria-label="Appointment type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">All appointment types</option>
          {workspace?.events.map((e: any) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </select>
        <select className="ui-input" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="confirmed">Confirmed</option>
          <option value="cancelled">Cancelled</option>
          <option value="all">All statuses</option>
        </select>
        <label className="cal-zone">
          <Icon name="globe" size={15} />
          <input
            className="ui-input"
            aria-label="Timezone"
            value={zone}
            list="calendar-zones"
            onChange={(e) => {
              try {
                new Intl.DateTimeFormat("en", { timeZone: e.target.value });
                setZone(e.target.value);
              } catch {}
            }}
          />
          <datalist id="calendar-zones">
            {["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London"].map((z) => (
              <option key={z}>{z}</option>
            ))}
          </datalist>
        </label>
        <a className="cal-team-link" href="/app/team">
          Team schedules
        </a>
      </div>
        {data?.errors.map((e: any) => (
          <p role="alert" className="ui-alert ui-alert-warning" key={e.account}>
            {e.account}: {e.message}{" "}
            <a href="/app/connections">Manage connection</a>
          </p>
        ))}

      {selected && (
        <Modal title={selected.title} onClose={() => !busy && setSelected(null)}>
          <div className="ui-form">
            <dl className="ui-dl">
              <dt>Guest</dt>
              <dd>{selected.guest_name}</dd>
              <dt>When</dt>
              <dd>
                {new Date(selected.starts_at).toLocaleString([], {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: zone,
                })}
              </dd>
              <dt>Status</dt>
              <dd>
                <Badge tone={selected.status === "confirmed" ? "success" : "neutral"}>{selected.status}</Badge>
              </dd>
            </dl>
            {selected.status === "confirmed" && (
              <form className="cal-move" onSubmit={move}>
                <Field label="Move to" hint={`Times in ${zone.replaceAll("_", " ")}. Availability is checked first.`}>
                  <input name="time" type="datetime-local" required />
                </Field>
                <button className="ui-btn ui-btn-primary" disabled={busy}>
                  Reschedule
                </button>
              </form>
            )}
            <div className="ui-modal-actions">
              {selected.status === "confirmed" && (
                <button
                  className="ui-btn ui-btn-danger"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      !(await confirm({
                        title: "Cancel this appointment?",
                        body: `${selected.guest_name} will be notified.`,
                        confirmLabel: "Cancel appointment",
                        danger: true,
                      }))
                    )
                      return;
                    setBusy(true);
                    try {
                      const r = await fetch("/api/workspace", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "cancel", id: selected.id }),
                      });
                      if (!r.ok) throw Error((await r.json()).error);
                      setSelected(null);
                      setMessage("Appointment cancelled.");
                      await load();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Cancel appointment
                </button>
              )}
              <button className="ui-btn ui-btn-secondary" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
      {confirmNode}
      {view === "day" || view === "week" ? (
        <TimeGrid
          days={Array.from({ length: days }, (_, i) => shift(start, i))}
          events={events}
          zone={zone}
          onSelect={setSelected}
        />
      ) : (
        <div className={"calendar-board calendar-" + view}>
        {Array.from({ length: days }, (_, i) => shift(start, i)).map((day) => (
          <section className="calendar-day" key={day}>
            <h2>
              {new Date(day + "T12:00:00Z").toLocaleDateString([], {
                weekday: "short",
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              })}
            </h2>
            {events
              .filter((e: any) =>
                e.allDay
                  ? e.starts_at <= day && e.ends_at > day
                  : key(new Date(e.starts_at), zone) <= day &&
                    key(new Date(Date.parse(e.ends_at) - 1), zone) >= day,
              )
              .map((e: any) => (
                <button
                  className={"calendar-entry " + (e.readOnly ? "external" : "")}
                  key={e.id}
                  disabled={e.readOnly}
                  onClick={() => setSelected(e)}
                >
                  <strong>{e.title}</strong>
                  <small>
                    {e.allDay
                      ? "All day"
                      : new Date(e.starts_at).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                          timeZone: zone,
                        })}{" "}
                    ·{" "}
                    {(e.sourceLabel || "Zenvio") +
                      " · " +
                      (e.readOnly ? "read only" : e.status)}
                  </small>
                  <small>{e.guest_name}</small>
                </button>
              ))}
          </section>
        ))}
      </div>
      )}
      {creating && workspace && (
        <CreateAppointment
          data={workspace}
          busy={busy}
          onClose={() => setCreating(false)}
          onSave={async (v) => {
            setBusy(true);
            try {
              const r = await fetch("/api/workspace", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "create-appointment", ...v }),
                }),
                d = await r.json();
              if (!r.ok) throw Error(d.error);
              setCreating(false);
              setMessage("Appointment created.");
              await load();
              return true;
            } catch (e) {
              setError((e as Error).message);
              return false;
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </SuiteShell>
  );
}

const HOUR = 64;
const minutesIn = (d: Date, zone: string) => {
  const p = inZone(d, zone);
  return +p.hour * 60 + +p.minute;
};
function TimeGrid({
  days,
  events,
  zone,
  onSelect,
}: {
  days: string[];
  events: any[];
  zone: string;
  onSelect: (e: any) => void;
}) {
  const now = new Date(),
    today = key(now, zone);
  const allDay = (day: string) =>
    events.filter((e) => e.allDay && e.starts_at <= day && e.ends_at > day);
  const timed = days.map((day) => {
    const items = events
      .filter(
        (e) =>
          !e.allDay &&
          key(new Date(e.starts_at), zone) <= day &&
          key(new Date(Date.parse(e.ends_at) - 1), zone) >= day,
      )
      .map((e) => {
        const start = new Date(e.starts_at),
          end = new Date(e.ends_at);
        const from = key(start, zone) === day ? minutesIn(start, zone) : 0,
          to =
            key(new Date(+end - 1), zone) === day
              ? minutesIn(end, zone) || 1440
              : 1440;
        return { e, from, to: Math.max(to, from + 15), lane: 0 };
      })
      .sort((a, b) => a.from - b.from || b.to - a.to);
    // Side-by-side lanes for overlapping appointments.
    const ends: number[] = [];
    for (const item of items) {
      let lane = ends.findIndex((end) => end <= item.from);
      if (lane < 0) lane = ends.length;
      ends[lane] = item.to;
      item.lane = lane;
    }
    return { day, items, lanes: Math.max(1, ends.length) };
  });
  const all = timed.flatMap((d) => d.items);
  const first = Math.min(8, ...all.map((i) => Math.floor(i.from / 60))),
    last = Math.max(18, ...all.map((i) => Math.ceil(i.to / 60)));
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const hasAllDay = days.some((d) => allDay(d).length);
  const label = (h: number) =>
    new Date(Date.UTC(2000, 0, 1, h)).toLocaleTimeString([], {
      hour: "numeric",
      timeZone: "UTC",
    });
  return (
    <div className="time-grid-scroll">
      <div
        className="time-grid"
        style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(${days.length > 1 ? 110 : 0}px, 1fr))` }}
      >
        <div className="time-grid-corner" />
        {days.map((day) => (
          <div
            key={day}
            className={"time-grid-head" + (day === today ? " today" : "")}
          >
            <span>
              {new Date(day + "T12:00:00Z").toLocaleDateString([], {
                weekday: "short",
                timeZone: "UTC",
              })}
            </span>
            <b>{Number(day.slice(8))}</b>
          </div>
        ))}
        {hasAllDay && (
          <>
            <div className="time-grid-gutter-label">All day</div>
            {days.map((day) => (
              <div key={day} className="time-grid-allday">
                {allDay(day).map((e) => (
                  <span key={e.id} className="calendar-entry external">
                    {e.title}
                  </span>
                ))}
              </div>
            ))}
          </>
        )}
        <div className="time-grid-hours" style={{ height: hours.length * HOUR }}>
          {hours.map((h) => (
            <span key={h} style={{ top: (h - first) * HOUR }}>
              {label(h)}
            </span>
          ))}
        </div>
        {timed.map(({ day, items, lanes }) => (
          <div
            key={day}
            className={"time-grid-day" + (day === today ? " today" : "")}
            style={{ height: hours.length * HOUR, backgroundSize: `100% ${HOUR}px` }}
          >
            {day === today && (
              <i
                className="time-grid-now"
                style={{ top: ((minutesIn(now, zone) - first * 60) / 60) * HOUR }}
              />
            )}
            {items.map(({ e, from, to, lane }) => (
              <button
                key={e.id + day}
                className={
                  "time-grid-event" +
                  (to - from < 45 ? " compact" : "") +
                  (e.readOnly ? " external" : "") +
                  (e.status === "cancelled" ? " cancelled" : "")
                }
                disabled={e.readOnly}
                onClick={() => onSelect(e)}
                style={{
                  top: ((from - first * 60) / 60) * HOUR,
                  height: Math.max(((to - from) / 60) * HOUR - 2, 20),
                  left: `calc(${(lane / lanes) * 100}% + 2px)`,
                  width: `calc(${100 / lanes}% - 4px)`,
                }}
                title={`${e.title}${e.guest_name ? " · " + e.guest_name : ""}`}
              >
                <strong>{e.title}</strong>
                <small>
                  {new Date(e.starts_at).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: zone,
                  })}
                  {e.guest_name ? " · " + e.guest_name : ""}
                  {e.readOnly ? " · " + (e.sourceLabel || "Busy") : ""}
                </small>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function rangeLabel(start: string, days: number, view: string) {
  const d = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
  if (view === "month") return d(start, { month: "long", year: "numeric" });
  if (days === 1) return d(start, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const end = shift(start, days - 1);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return `${d(start, { month: "short", day: "numeric" })} – ${d(end, sameMonth ? { day: "numeric", year: "numeric" } : { month: "short", day: "numeric", year: "numeric" })}`;
}
