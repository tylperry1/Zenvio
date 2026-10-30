"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "./icons";
import { Modal } from "./modal";
import { SuiteShell } from "./suite-shell";
import {
  Alert,
  Badge,
  Card,
  CopyField,
  EmptyState,
  Field,
  Meter,
  Skeleton,
  Tabs,
  duration,
  formatDateTime,
  slugify,
  useConfirm,
  useToast,
} from "./ui";

type Org = { id: string; name: string; slug: string; role: string };
type Member = { user_id: string; name: string; email: string; role: string; active: boolean };
type Tab = "members" | "pages" | "appointments" | "settings";
const roleLabel = (r: string) => (r === "administrator" ? "Manager" : r[0].toUpperCase() + r.slice(1));

export function TeamCenter() {
  const [orgs, setOrgs] = useState<Org[] | null>(null),
    [selected, setSelected] = useState(""),
    [data, setData] = useState<any>(null),
    [tab, setTab] = useState<Tab>("members"),
    [busy, setBusy] = useState(false),
    [loadError, setLoadError] = useState(""),
    [memberSearch, setMemberSearch] = useState(""),
    [staffFilter, setStaffFilter] = useState(""),
    [modal, setModal] = useState<"create" | "invite" | "event" | null>(null),
    [link, setLink] = useState("");
  const toast = useToast();
  const { confirm, node: confirmNode } = useConfirm();
  async function load() {
    const r = await fetch("/api/teams", { cache: "no-store" }),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    setOrgs(d.organizations);
    return d.organizations as Org[];
  }
  async function open(id: string) {
    setSelected(id);
    setData(null);
    if (!id) return;
    const r = await fetch("/api/teams?id=" + id, { cache: "no-store" }),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    setData(d);
  }
  useEffect(() => {
    load()
      .then((list) => list[0] && open(list[0].id))
      .catch((e) => setLoadError(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function action(v: Record<string, unknown>, success: string) {
    if (busy) return false;
    setBusy(true);
    try {
      const r = await fetch("/api/teams", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...v, organization: selected }),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (d.invitationPath) setLink(location.origin + d.invitationPath);
      toast.show(success);
      await load();
      await open(d.id || selected);
      return true;
    } catch (e) {
      toast.show((e as Error).message, true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const org = orgs?.find((o) => o.id === selected);
  const manager = data && data.role !== "staff";
  const members: Member[] = data?.members || [];
  const nameOf = (id: string) => members.find((m) => m.user_id === id)?.name || "Former member";
  return (
    <SuiteShell
      title="Team"
      description="Share booking pages across your team, assign appointments fairly, and manage who has access."
      actions={
        <>
          {orgs && orgs.length > 1 && (
            <select
              className="ui-input"
              aria-label="Team workspace"
              value={selected}
              onChange={(e) => open(e.target.value).catch((err) => toast.show(err.message, true))}
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
          <button className="ui-btn ui-btn-secondary" onClick={() => setModal("create")}>
            <Icon name="plus" size={15} /> New team
          </button>
        </>
      }
    >
      {loadError && <Alert tone="danger" title="We couldn’t load your teams">{loadError}</Alert>}
      {!orgs && !loadError && (
        <Card>
          <Skeleton rows={4} />
        </Card>
      )}
      {orgs && !orgs.length && (
        <Card>
          <EmptyState
            icon="team"
            title="Bring your team together"
            action={
              <button className="ui-btn ui-btn-primary" onClick={() => setModal("create")}>
                Create a team workspace
              </button>
            }
          >
            Team workspaces share booking pages across staff and assign each appointment to whoever is free. They’re
            part of the Teams package.
          </EmptyState>
        </Card>
      )}
      {selected && !data && orgs?.length ? (
        <Card>
          <Skeleton rows={4} />
        </Card>
      ) : null}
      {data && org && (
        <>
          <div className="team-hero">
            <span className="team-avatar">{org.name.slice(0, 2).toUpperCase()}</span>
            <div>
              <h2>{org.name}</h2>
              <span className="ui-meta">
                <span>/team/{org.slug}</span>
                <Badge tone="info">Your role: {roleLabel(data.role)}</Badge>
              </span>
            </div>
            <div className="team-seats">
              <span>
                <b>{data.occupied}</b> of {data.seats} seats in use
              </span>
              <Meter value={data.occupied} max={data.seats} label="Seats in use" />
              {data.canManageBilling && (
                <Link href="/app/billing" className="team-seat-link">
                  Manage seats
                </Link>
              )}
            </div>
          </div>
          <Tabs
            label="Team sections"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "members", label: "Members", count: members.length },
              { id: "pages", label: "Booking pages", count: data.events.length },
              { id: "appointments", label: "Appointments", count: data.bookings.length },
              ...(manager ? [{ id: "settings" as const, label: "Settings" }] : []),
            ]}
          />

          {tab === "members" && (
            <>
              <Card
                title="Members"
                description="Everyone on the team uses their own account. Each active member uses a paid seat."
                actions={
                  <>
                    <input
                      className="ui-input team-search"
                      type="search"
                      placeholder="Search members"
                      aria-label="Search members"
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                    />
                    {manager && (
                      <button className="ui-btn ui-btn-primary" onClick={() => setModal("invite")}>
                        <Icon name="plus" size={15} /> Invite
                      </button>
                    )}
                  </>
                }
                flush
              >
                <div className="ui-table-wrap">
                  <table className="ui-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Role</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {members
                        .filter((m) => `${m.name} ${m.email}`.toLowerCase().includes(memberSearch.toLowerCase()))
                        .map((m) => {
                          const canManage =
                            manager && m.role !== "owner" && (data.role === "owner" || m.role === "staff");
                          return (
                            <tr key={m.user_id}>
                              <td>
                                <span className="client-name">
                                  <span className="client-avatar">
                                    {m.name
                                      .split(/\s+/)
                                      .map((w) => w[0])
                                      .slice(0, 2)
                                      .join("")
                                      .toUpperCase()}
                                  </span>
                                  <span>
                                    {m.name}
                                    <span className="ui-cell-sub">{m.email}</span>
                                  </span>
                                </span>
                              </td>
                              <td>
                                {data.role === "owner" && m.role !== "owner" ? (
                                  <select
                                    className="ui-input team-role"
                                    disabled={busy}
                                    aria-label={`Role for ${m.name}`}
                                    value={m.role}
                                    onChange={(e) =>
                                      void action({ action: "role", user_id: m.user_id, role: e.target.value }, "Role updated.")
                                    }
                                  >
                                    <option value="staff">Staff</option>
                                    <option value="administrator">Manager</option>
                                  </select>
                                ) : (
                                  roleLabel(m.role)
                                )}
                              </td>
                              <td>
                                <Badge tone={m.active ? "success" : "neutral"}>{m.active ? "Active" : "Inactive"}</Badge>
                              </td>
                              <td className="ui-cell-actions">
                                {canManage &&
                                  (m.active ? (
                                    <button
                                      className="ui-btn ui-btn-ghost ui-btn-sm"
                                      disabled={busy}
                                      onClick={async () => {
                                        if (
                                          await confirm({
                                            title: `Deactivate ${m.name}?`,
                                            body: "They keep their account but lose access to this team and stop receiving team appointments. Reassign or cancel their upcoming team appointments first.",
                                            confirmLabel: "Deactivate",
                                            danger: true,
                                          })
                                        )
                                          void action({ action: "remove", user_id: m.user_id }, `${m.name} deactivated.`);
                                      }}
                                    >
                                      Deactivate
                                    </button>
                                  ) : (
                                    <button
                                      className="ui-btn ui-btn-secondary ui-btn-sm"
                                      disabled={busy}
                                      onClick={() =>
                                        void action({ action: "reactivate", user_id: m.user_id }, `${m.name} reactivated.`)
                                      }
                                    >
                                      Reactivate
                                    </button>
                                  ))}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </Card>
              {manager && (
                <Card title="Pending invitations" flush>
                  {!data.invitations?.length ? (
                    <EmptyState icon="mail" title="No pending invitations">
                      Invitations you create appear here until they’re accepted or expire.
                    </EmptyState>
                  ) : (
                    <ul className="ui-list">
                      {data.invitations.map((i: any) => (
                        <li key={i.id}>
                          <span className="ui-list-icon">
                            <Icon name="mail" size={16} />
                          </span>
                          <div className="ui-list-main">
                            <b>{i.email}</b>
                            <small>
                              {roleLabel(i.role)} · expires {new Date(i.expires_at).toLocaleDateString()}
                            </small>
                          </div>
                          {(data.role === "owner" || i.role === "staff") && (
                            <button
                              className="ui-btn ui-btn-ghost ui-btn-sm"
                              disabled={busy}
                              onClick={() => void action({ action: "revoke-invite", invite_id: i.id }, "Invitation revoked.")}
                            >
                              Revoke
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}
            </>
          )}

          {tab === "pages" && (
            <Card
              title="Shared booking pages"
              description="Clients book a team appointment type and Zenvio assigns the available staff member who was booked least recently."
              actions={
                manager && (
                  <button className="ui-btn ui-btn-primary" onClick={() => setModal("event")}>
                    <Icon name="plus" size={15} /> New booking page
                  </button>
                )
              }
              flush
            >
              {!data.events.length ? (
                <EmptyState icon="link" title="No shared booking pages yet">
                  Create one to let clients book whoever on the team is free.
                </EmptyState>
              ) : (
                <ul className="ui-list">
                  {data.events.map((e: any) => (
                    <li key={e.id}>
                      <span className="ui-list-icon">
                        <Icon name="link" size={16} />
                      </span>
                      <div className="ui-list-main">
                        <b>{e.title}</b>
                        <small>
                          {duration(e.duration)}
                          {e.buffer ? ` · ${duration(e.buffer)} buffer` : ""}
                        </small>
                      </div>
                      <div className="team-link">
                        <CopyField label={`Link for ${e.title}`} value={`${location.origin}/team/${org.slug}/${e.slug}`} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {tab === "appointments" && (
            <Card
              title="Team appointments"
              actions={
                <select
                  className="ui-input"
                  aria-label="Filter by staff member"
                  value={staffFilter}
                  onChange={(e) => setStaffFilter(e.target.value)}
                >
                  <option value="">All staff</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              }
              flush
            >
              {(() => {
                const rows = data.bookings.filter((b: any) => !staffFilter || b.user_id === staffFilter);
                if (!rows.length)
                  return (
                    <EmptyState icon="calendar" title="No team appointments">
                      Appointments booked through shared pages appear here.
                    </EmptyState>
                  );
                return (
                  <div className="ui-table-wrap">
                    <table className="ui-table">
                      <thead>
                        <tr>
                          <th>When</th>
                          <th>Appointment</th>
                          <th>Assigned to</th>
                          <th>Status</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((b: any) => (
                          <tr key={b.id}>
                            <td>{formatDateTime(b.starts_at)}</td>
                            <td className="ui-cell-strong">
                              {b.title}
                              <span className="ui-cell-sub">{b.guest_name}</span>
                            </td>
                            <td>{nameOf(b.user_id)}</td>
                            <td>
                              <Badge tone={b.status === "confirmed" ? "success" : "neutral"}>{b.status}</Badge>
                            </td>
                            <td className="ui-cell-actions">
                              {manager && b.status === "confirmed" && (
                                <span className="team-row-actions">
                                  <select
                                    className="ui-input team-role"
                                    aria-label={`Reassign ${b.guest_name}`}
                                    value=""
                                    disabled={busy}
                                    onChange={async (e) => {
                                      const to = e.target.value;
                                      if (
                                        to &&
                                        (await confirm({
                                          title: `Reassign to ${nameOf(to)}?`,
                                          body: "Zenvio checks their availability first. The client keeps the same time.",
                                          confirmLabel: "Reassign",
                                        }))
                                      )
                                        void action({ action: "reassign", booking_id: b.id, user_id: to }, "Appointment reassigned.");
                                    }}
                                  >
                                    <option value="">Reassign…</option>
                                    {members
                                      .filter((m) => m.active && m.user_id !== b.user_id)
                                      .map((m) => (
                                        <option key={m.user_id} value={m.user_id}>
                                          {m.name}
                                        </option>
                                      ))}
                                  </select>
                                  <button
                                    className="ui-btn ui-btn-ghost ui-btn-sm"
                                    disabled={busy}
                                    onClick={async () => {
                                      if (
                                        await confirm({
                                          title: "Cancel this appointment?",
                                          body: `${b.guest_name} will be notified that ${b.title} is cancelled.`,
                                          confirmLabel: "Cancel appointment",
                                          danger: true,
                                        })
                                      )
                                        void action({ action: "cancel", booking_id: b.id }, "Appointment cancelled.");
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </Card>
          )}

          {tab === "settings" && manager && (
            <>
              <Card title="Workspace name">
                <form
                  className="team-rename"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action({ action: "rename", name: new FormData(e.currentTarget).get("name") }, "Team renamed.");
                  }}
                >
                  <Field label="Name">
                    <input name="name" required minLength={2} maxLength={100} defaultValue={org.name} key={org.id} />
                  </Field>
                  <button className="ui-btn ui-btn-primary" disabled={busy}>
                    Save
                  </button>
                </form>
              </Card>
              <Card title="Permissions">
                <dl className="ui-dl">
                  <dt>Owner</dt>
                  <dd>Everything, including manager roles, billing, and paid seats.</dd>
                  <dt>Managers</dt>
                  <dd>Invite and manage staff, rename the team, and manage shared booking pages and appointments.</dd>
                  <dt>Staff</dt>
                  <dd>Receive team appointments and see the team schedule.</dd>
                </dl>
              </Card>
            </>
          )}
        </>
      )}

      {modal === "create" && (
        <Modal title="New team workspace" onClose={() => !busy && setModal(null)}>
          <CreateTeamForm
            busy={busy}
            onCancel={() => setModal(null)}
            onSave={async (v) => {
              if (await action({ action: "create", ...v }, "Team workspace created.")) setModal(null);
            }}
          />
        </Modal>
      )}
      {modal === "invite" && (
        <Modal
          title="Invite a team member"
          onClose={() => {
            if (busy) return;
            setModal(null);
            setLink("");
          }}
        >
          {link ? (
            <div className="ui-form">
              <Alert tone="success" title="Invitation created">
                Send this private link to the person you invited. They must sign in with the invited email address. Zenvio
                hasn’t emailed it.
              </Alert>
              <CopyField label="Invitation link" value={link} />
              <div className="ui-modal-actions">
                <button
                  className="ui-btn ui-btn-primary"
                  onClick={() => {
                    setModal(null);
                    setLink("");
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form
              className="ui-form"
              onSubmit={(e) => {
                e.preventDefault();
                void action({ action: "invite", ...Object.fromEntries(new FormData(e.currentTarget)) }, "Invitation created.");
              }}
            >
              <Field label="Email address">
                <input name="email" type="email" required autoFocus />
              </Field>
              <Field label="Role" hint="Managers can invite and manage staff. Only the owner can make managers.">
                <select name="role">
                  <option value="staff">Staff</option>
                  {data?.role === "owner" && <option value="administrator">Manager</option>}
                </select>
              </Field>
              <div className="ui-modal-actions">
                <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setModal(null)}>
                  Cancel
                </button>
                <button className="ui-btn ui-btn-primary" disabled={busy}>
                  {busy ? "Creating…" : "Create invitation"}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
      {modal === "event" && (
        <Modal title="New shared booking page" onClose={() => !busy && setModal(null)}>
          <SharedEventForm
            busy={busy}
            members={members.filter((m) => m.active)}
            onCancel={() => setModal(null)}
            onSave={async (v) => {
              if (await action({ action: "event", ...v }, "Booking page created.")) setModal(null);
            }}
          />
        </Modal>
      )}
      {confirmNode}
      {toast.node}
    </SuiteShell>
  );
}

function CreateTeamForm({
  busy,
  onCancel,
  onSave,
}: {
  busy: boolean;
  onCancel: () => void;
  onSave: (v: { name: string; slug: string }) => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [edited, setEdited] = useState(false);
  return (
    <form
      className="ui-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ name, slug });
      }}
    >
      <Alert tone="info">Team workspaces need an active Teams package with at least three seats.</Alert>
      <Field label="Team name">
        <input
          required
          autoFocus
          value={name}
          maxLength={100}
          onChange={(e) => {
            setName(e.target.value);
            if (!edited) setSlug(slugify(e.target.value));
          }}
        />
      </Field>
      <Field label="Public address" hint={`Clients book at /team/${slug || "your-team"}/…`}>
        <input
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          value={slug}
          onChange={(e) => {
            setEdited(true);
            setSlug(e.target.value.toLowerCase());
          }}
        />
      </Field>
      <div className="ui-modal-actions">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="ui-btn ui-btn-primary" disabled={busy}>
          {busy ? "Creating…" : "Create team"}
        </button>
      </div>
    </form>
  );
}

function SharedEventForm({
  busy,
  members,
  onCancel,
  onSave,
}: {
  busy: boolean;
  members: Member[];
  onCancel: () => void;
  onSave: (v: { title: string; slug: string; duration: number; buffer: number; staff: string[] }) => void;
}) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [edited, setEdited] = useState(false);
  const [staff, setStaff] = useState<string[]>(members.map((m) => m.user_id));
  return (
    <form
      className="ui-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onSave({ title, slug, duration: Number(f.get("duration")), buffer: Number(f.get("buffer")), staff });
      }}
    >
      <div className="ui-form-grid">
        <Field label="Title" wide>
          <input
            required
            autoFocus
            value={title}
            maxLength={100}
            placeholder="e.g. Initial consultation"
            onChange={(e) => {
              setTitle(e.target.value);
              if (!edited) setSlug(slugify(e.target.value));
            }}
          />
        </Field>
        <Field label="Link ending" wide>
          <input
            required
            value={slug}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            onChange={(e) => {
              setEdited(true);
              setSlug(e.target.value.toLowerCase());
            }}
          />
        </Field>
        <Field label="Length">
          <select name="duration" defaultValue={30}>
            {[15, 20, 30, 45, 60, 90, 120, 180, 240].map((m) => (
              <option key={m} value={m}>
                {duration(m)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Buffer after">
          <select name="buffer" defaultValue={15}>
            {[0, 5, 10, 15, 30, 45, 60].map((m) => (
              <option key={m} value={m}>
                {m ? duration(m) : "No buffer"}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="ui-field">
        <span className="ui-label">Who can be booked</span>
        <div className="team-staff-picks">
          {members.map((m) => (
            <label key={m.user_id}>
              <input
                type="checkbox"
                checked={staff.includes(m.user_id)}
                onChange={(e) =>
                  setStaff(e.target.checked ? [...staff, m.user_id] : staff.filter((id) => id !== m.user_id))
                }
              />
              {m.name}
            </label>
          ))}
        </div>
      </div>
      <div className="ui-modal-actions">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="ui-btn ui-btn-primary" disabled={busy || !staff.length}>
          {busy ? "Creating…" : "Create booking page"}
        </button>
      </div>
    </form>
  );
}
