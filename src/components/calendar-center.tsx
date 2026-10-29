"use client";
import { useEffect, useState } from "react";
import { SuiteShell } from "./suite-shell";
import { CreateAppointment } from "./create-appointment";
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
    fetch("/api/workspace")
      .then((r) => r.json())
      .then((d) => setWorkspace(d));
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
      description="Zenvio appointments and read-only connected calendars, with clear source labels."
      actions={
        <button disabled={!workspace} onClick={() => setCreating(true)}>
          + New appointment
        </button>
      }
    >
      {error && (
        <p role="alert" className="billing-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <section>
        <div className="calendar-toolbar">
          <button
            className="calendar-step"
            onClick={() => setDate(shift(start, -days))}
            aria-label="Previous period"
          >
            ←
          </button>
          <input
            type="date"
            aria-label="Calendar date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <button
            className="calendar-step"
            onClick={() => setDate(shift(start, days))}
            aria-label="Next period"
          >
            →
          </button>
          <select
            aria-label="Calendar view"
            value={view}
            onChange={(e) => setView(e.target.value)}
          >
            {["day", "week", "month", "agenda"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <label className="calendar-zone">
            <span>Timezone</span>
            <input
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
              {[
                "UTC",
                "America/New_York",
                "America/Chicago",
                "America/Denver",
                "America/Los_Angeles",
                "Europe/London",
              ].map((z) => (
                <option key={z}>{z}</option>
              ))}
            </datalist>
          </label>
        </div>
        <div className="suite-grid">
          <label>
            Calendar source
            <select
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              <option value="all">All sources</option>
              <option value="zenvio">Zenvio only</option>
              {data?.accounts.map((a: any) => (
                <option key={a.account_sub} value={a.account_sub}>
                  {a.account_email}
                </option>
              ))}
            </select>
          </label>
          <label>
            Appointment type
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="all">All types</option>
              {workspace?.events.map((e: any) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="confirmed">Confirmed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <a href="/app/team">Team appointments & staff filters →</a>
        </div>
        {data?.errors.map((e: any) => (
          <p role="alert" key={e.account}>
            {e.account}: {e.message}{" "}
            <a href="/app/connections">Manage connection</a>
          </p>
        ))}
      </section>
      {selected && (
        <section>
          <h2>{selected.title}</h2>
          <p>
            {selected.guest_name} ·{" "}
            {new Date(selected.starts_at).toLocaleString([], {
              timeZone: zone,
            })}
          </p>
          <form className="stack-form" onSubmit={move}>
            <label>
              Move to a new time · {zone}
              <input name="time" type="datetime-local" required />
            </label>
            <button disabled={busy}>Check availability & reschedule</button>
          </form>
          <button
            className="billing-secondary"
            disabled={busy}
            onClick={async () => {
              if (!confirm("Cancel this appointment?")) return;
              setBusy(true);
              try {
                const r = await fetch("/api/workspace", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "cancel", id: selected.id }),
                });
                if (!r.ok) throw Error((await r.json()).error);
                setSelected(null);
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
          <button
            className="billing-secondary"
            onClick={() => setSelected(null)}
          >
            Close
          </button>
        </section>
      )}
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
