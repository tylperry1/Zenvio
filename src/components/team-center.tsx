"use client";
import { useEffect, useState } from "react";
import { SuiteShell } from "./suite-shell";
export function TeamCenter() {
  const [staffFilter, setStaffFilter] = useState("");
  const [orgs, setOrgs] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [link, setLink] = useState("");
  async function load() {
    const r = await fetch("/api/teams"),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    setOrgs(d.organizations);
  }
  async function open(id: string) {
    setSelected(id);
    const r = await fetch("/api/teams?id=" + id),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    setData(d);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function action(v: any) {
    try {
      const r = await fetch("/api/teams", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...v, organization: selected }),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (d.invitationPath) setLink(location.origin + d.invitationPath);
      setMessage("Workspace updated.");
      await load();
      if (selected) await open(selected);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <SuiteShell
      title="Team workspace"
      description="Shared scheduling with personal availability, protected staff access, and round-robin assignment."
    >
      {error && (
        <p role="alert" className="billing-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {link && (
        <section>
          <h2>Private invitation link</h2>
          <p>
            Share only with the invited email. The recipient must sign in with
            that address. No email has been sent.
          </p>
          <input readOnly value={link} aria-label="Team invitation link" />
        </section>
      )}
      <section>
        <label>
          Workspace
          <select
            value={selected}
            onChange={(e) =>
              open(e.target.value).catch((e) => setError(e.message))
            }
          >
            <option value="">Choose a workspace</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {o.role}
              </option>
            ))}
          </select>
        </label>
        <details>
          <summary>Create workspace</summary>
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              void action({
                action: "create",
                ...Object.fromEntries(new FormData(e.currentTarget)),
              });
            }}
          >
            <p>
              An active Teams plan and at least three paid hosts are required.
            </p>
            <label>
              Name
              <input name="name" required />
            </label>
            <label>
              Public address
              <input name="slug" required pattern="[a-z0-9-]+" />
            </label>
            <button>Create workspace</button>
          </form>
        </details>
      </section>
      {data && (
        <>
          <section>
            <h2>Members</h2>
            {data.members.map((m: any) => (
              <article className="suite-row" key={m.user_id}>
                <div>
                  <strong>{m.name}</strong>
                  <small>
                    {m.email} · {m.role} · {m.active ? "Active" : "Removed"}
                  </small>
                </div>
                {data.role !== "staff" && m.role !== "owner" && m.active && (
                  <button
                    onClick={() => {
                      if (
                        confirm(
                          "Remove this member? Upcoming appointments must be handled first.",
                        )
                      )
                        void action({ action: "remove", user_id: m.user_id });
                    }}
                  >
                    Remove
                  </button>
                )}
              </article>
            ))}
            {data.role !== "staff" && (
              <form
                className="suite-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  void action({
                    action: "invite",
                    ...Object.fromEntries(new FormData(e.currentTarget)),
                  });
                }}
              >
                <label>
                  Invite email
                  <input name="email" type="email" required />
                </label>
                <label>
                  Role
                  <select name="role">
                    <option value="staff">Staff</option>
                    {data.role === "owner" && (
                      <option value="administrator">Administrator</option>
                    )}
                  </select>
                </label>
                <button>Create invitation</button>
              </form>
            )}
          </section>
          <section>
            <h2>Shared appointment types</h2>
            {data.events.map((e: any) => (
              <p key={e.id}>
                {e.title} · {e.duration} min · {location.origin}/team/
                {orgs.find((o) => o.id === selected)?.slug}/{e.slug}
              </p>
            ))}
            {data.role !== "staff" && (
              <form
                className="stack-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void action({
                    action: "event",
                    title: f.get("title"),
                    slug: f.get("slug"),
                    duration: Number(f.get("duration")),
                    buffer: Number(f.get("buffer")),
                    staff: f.getAll("staff"),
                  });
                }}
              >
                <label>
                  Title
                  <input name="title" required />
                </label>
                <label>
                  Public address
                  <input name="slug" required />
                </label>
                <label>
                  Duration (minutes)
                  <input
                    name="duration"
                    type="number"
                    min={5}
                    max={240}
                    defaultValue={30}
                  />
                </label>
                <label>
                  Buffer (minutes)
                  <input
                    name="buffer"
                    type="number"
                    min={0}
                    max={60}
                    defaultValue={15}
                  />
                </label>
                {data.members
                  .filter((m: any) => m.active)
                  .map((m: any) => (
                    <label className="document-checkbox" key={m.user_id}>
                      <input name="staff" type="checkbox" value={m.user_id} />
                      {m.name}
                    </label>
                  ))}
                <button>Create shared type</button>
              </form>
            )}
          </section>
          <section>
            <h2>Team appointments</h2>
            <label>
              Staff filter
              <select
                value={staffFilter}
                onChange={(e) => setStaffFilter(e.target.value)}
              >
                <option value="">All authorized staff</option>
                {data.members.map((m: any) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            {data.bookings
              .filter((b: any) => !staffFilter || b.user_id === staffFilter)
              .map((b: any) => (
                <article className="suite-row" key={b.id}>
                  <div>
                    <strong>
                      {b.title} · {b.guest_name}
                    </strong>
                    <small>
                      {new Date(b.starts_at).toLocaleString()} ·{" "}
                      {
                        data.members.find((m: any) => m.user_id === b.user_id)
                          ?.name
                      }{" "}
                      · {b.status}
                    </small>
                  </div>
                  {data.role !== "staff" && b.status === "confirmed" && (
                    <>
                      <select
                        aria-label={"Reassign " + b.guest_name}
                        defaultValue=""
                        onChange={(e) => {
                          if (
                            e.target.value &&
                            confirm(
                              "Check availability and reassign this appointment?",
                            )
                          )
                            void action({
                              action: "reassign",
                              booking_id: b.id,
                              user_id: e.target.value,
                            });
                        }}
                      >
                        <option value="">Reassign staff…</option>
                        {data.members
                          .filter(
                            (m: any) => m.active && m.user_id !== b.user_id,
                          )
                          .map((m: any) => (
                            <option key={m.user_id} value={m.user_id}>
                              {m.name}
                            </option>
                          ))}
                      </select>
                      <button
                        onClick={() => {
                          if (confirm("Cancel this team appointment?"))
                            void action({ action: "cancel", booking_id: b.id });
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </article>
              ))}
          </section>
        </>
      )}
    </SuiteShell>
  );
}
