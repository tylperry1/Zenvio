"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "./icons";
import { SuiteShell } from "./suite-shell";
export function TeamCenter() {
  const [staffFilter, setStaffFilter] = useState("");
  const [memberSearch,setMemberSearch]=useState("");
  const [busy,setBusy]=useState(false);
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
    setData(null);
    if(!id)return;
    const r = await fetch("/api/teams?id=" + id),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    setData(d);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function action(v: any) {
    if(busy)return;
    setBusy(true);setError("");setMessage("");
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
      if (d.id) await open(d.id);
      else if (selected) await open(selected);
    } catch (e) {
      setError((e as Error).message);
    } finally {setBusy(false);}
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
            <div className="subscription-section-title"><div><span className="subscription-kicker">PEOPLE & PERMISSIONS</span><h2>Your team, together.</h2><p>{data.occupied} of {data.seats} paid seats in use. The owner is included.</p></div>{data.canManageBilling ? <Link className="billing-secondary" href="/app/billing">Manage paid seats <Icon name="arrow" size={15}/></Link> : <span className="subscription-monthly">Billing is managed by the owner</span>}</div>
            <label>Find a team member<input type="search" value={memberSearch} onChange={e=>setMemberSearch(e.target.value)} placeholder="Search name or email"/></label>
            {data.members.filter((m:any)=>`${m.name} ${m.email}`.toLowerCase().includes(memberSearch.toLowerCase())).map((m: any) => (
              <article className="suite-row" key={m.user_id}>
                <div>
                  <strong>{m.name}</strong>
                  <small>
                    {m.email} · {m.role === "administrator" ? "Manager" : m.role} · {m.active ? "Active" : "Inactive"}
                  </small>
                </div>
                <div className="team-member-actions">
                {data.role==="owner" && m.role!=="owner" && <select disabled={busy} aria-label={"Role for "+m.name} value={m.role} onChange={e=>void action({action:"role",user_id:m.user_id,role:e.target.value})}><option value="staff">Staff</option><option value="administrator">Manager</option></select>}
                {data.role!=="staff" && m.role!=="owner" && (data.role==="owner"||m.role==="staff") && !m.active && <button disabled={busy} onClick={()=>void action({action:"reactivate",user_id:m.user_id})}>Reactivate</button>}
                {data.role !== "staff" && m.role !== "owner" && (data.role==="owner"||m.role==="staff") && m.active && (
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
                    Deactivate
                  </button>
                )}
                </div>
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
                      <option value="administrator">Manager</option>
                    )}
                  </select>
                </label>
                <button>Create invitation</button>
              </form>
            )}
          </section>
          {data.role!=="staff" && <section><span className="subscription-kicker">WORKSPACE CONTROLS</span><h2>Team settings & invitations</h2><form className="suite-grid" onSubmit={e=>{e.preventDefault();void action({action:"rename",name:new FormData(e.currentTarget).get("name")});}}><label>Workspace name<input name="name" required minLength={2} maxLength={100} defaultValue={orgs.find(o=>o.id===selected)?.name} key={selected}/></label><button disabled={busy}>Save name</button></form><h3>Pending invitations</h3>{data.invitations?.length ? data.invitations.map((i:any)=><div className="suite-row" key={i.id}><div><b>{i.email}</b><small>{i.role==='administrator'?'Manager':'Staff'} · Expires {new Date(i.expires_at).toLocaleDateString()}</small></div>{(data.role==='owner'||i.role==='staff')&&<button disabled={busy} onClick={()=>void action({action:'revoke-invite',invite_id:i.id})}>Revoke invitation</button>}</div>):<p>No pending invitations.</p>}<p className="team-permission-note">Managers can invite and manage staff, edit the workspace name, and manage shared scheduling. Only owners assign manager roles or change subscriptions and paid seats. Each person signs in with their own account.</p></section>}
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
