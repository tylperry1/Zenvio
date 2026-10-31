"use client";
import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { Modal } from "./modal";

type Permission = string;
type Member = {
  id: string;
  name: string;
  email: string;
  verified: boolean;
  title: string;
  permissions: Permission[];
  workspace_plan: string | null;
  enabled: boolean;
  created_at: string;
  last_sign_in: string | null;
  invited_by: string | null;
  has_password: boolean;
};
type Data = {
  owner: { name: string; email: string } | null;
  staff: Member[];
  permissions: Record<Permission, { label: string; description: string }>;
  mail: boolean;
};
type Draft = {
  id?: string;
  name: string;
  email: string;
  title: string;
  permissions: Permission[];
  workspacePlan: string;
};

const planOptions = [
  ["team", "Full features (Team)"],
  ["individual", "Individual"],
  ["business", "Business"],
  ["pro", "Pro"],
  ["", "Their own subscription"],
] as const;
const planLabel = (p: string | null) =>
  planOptions.find(([id]) => id === (p || ""))?.[1] || "Their own subscription";
// Presets make common roles one click; individual toggles stay editable.
const presets: { label: string; permissions: Permission[] | "all" }[] = [
  { label: "Full access", permissions: "all" },
  { label: "Support", permissions: ["accounts", "feedback", "early-access", "subscriptions", "audit"] },
  { label: "Billing", permissions: ["subscriptions", "pricing", "entitlements"] },
  { label: "Commerce", permissions: ["marketplace"] },
  { label: "Engineering", permissions: ["health", "integrations", "assistant", "audit"] },
];
const initials = (name: string) =>
  name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
const ago = (s: string | null) => {
  if (!s) return "Never signed in";
  const days = Math.floor((Date.now() - +new Date(s)) / 86400000);
  return days < 1 ? "Active today" : days === 1 ? "Active yesterday" : `Active ${days} days ago`;
};

export function AdminTeam() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);

  async function load() {
    const r = await fetch("/api/admin/team", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Unable to load the team.");
    setData(d);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function act(input: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/admin/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Unable to save.");
      setNotice(d.message || "Saved.");
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const all = data ? Object.keys(data.permissions) : [];
  const active = data?.staff.filter((m) => m.enabled).length || 0;

  return (
    <div className="tm">
      <div className="tm-heading">
        <div>
          <h1>Team &amp; access</h1>
          <p>Add Zenvio employees, choose what they can manage in this console, and give them product features.</p>
        </div>
        <button
          className="tm-primary"
          disabled={!data}
          onClick={() =>
            setDraft({ name: "", email: "", title: "", permissions: ["accounts", "feedback"], workspacePlan: "team" })
          }
        >
          <Icon name="plus" size={16} /> Add employee
        </button>
      </div>

      {notice && <p className="tm-notice" role="status"><Icon name="check" size={15} /> {notice}</p>}
      {error && <p className="tm-notice error" role="alert">{error}</p>}

      {!data ? (
        !error && <div className="tm-loading">Loading team…</div>
      ) : (
        <>
          <div className="tm-stats">
            <article><small>Employees</small><b>{data.staff.length}</b></article>
            <article><small>Active</small><b>{active}</b></article>
            <article><small>Suspended</small><b>{data.staff.length - active}</b></article>
            <article>
              <small>Invitation email</small>
              <b className={data.mail ? "ok" : "warn"}>{data.mail ? "Ready" : "Not connected"}</b>
            </article>
          </div>

          <section className="tm-card">
            <header>
              <h2>Members</h2>
              <p>Access is checked on every request, so changes apply immediately.</p>
            </header>
            <ul className="tm-list">
              {data.owner && (
                <li className="tm-row owner">
                  <span className="tm-avatar owner">{initials(data.owner.name)}</span>
                  <div className="tm-person">
                    <b>{data.owner.name} <span className="tm-badge owner">Master admin</span></b>
                    <small>{data.owner.email}</small>
                  </div>
                  <div className="tm-scope">
                    <span className="tm-chip strong">Full console access</span>
                    <span className="tm-chip">Full features</span>
                  </div>
                  <div className="tm-actions"><small>Owner</small></div>
                </li>
              )}
              {data.staff.map((m) => {
                const full = all.every((p) => m.permissions.includes(p));
                return (
                  <li key={m.id} className={`tm-row ${m.enabled ? "" : "off"}`}>
                    <span className="tm-avatar">{initials(m.name)}</span>
                    <div className="tm-person">
                      <b>
                        {m.name}
                        {!m.enabled && <span className="tm-badge off">Suspended</span>}
                        {m.enabled && !m.has_password && <span className="tm-badge pending">Invite pending</span>}
                      </b>
                      <small>{m.email}{m.title ? ` · ${m.title}` : ""}</small>
                      <small className="tm-muted">{ago(m.last_sign_in)}</small>
                    </div>
                    <div className="tm-scope">
                      {full ? (
                        <span className="tm-chip strong">Full console access</span>
                      ) : m.permissions.length ? (
                        <>
                          {m.permissions.slice(0, 3).map((p) => (
                            <span key={p} className="tm-chip">{data.permissions[p]?.label || p}</span>
                          ))}
                          {m.permissions.length > 3 && <span className="tm-chip">+{m.permissions.length - 3} more</span>}
                        </>
                      ) : (
                        <span className="tm-chip muted">No console areas</span>
                      )}
                      <span className="tm-chip plan">{planLabel(m.workspace_plan)}</span>
                    </div>
                    <div className="tm-actions">
                      <button
                        onClick={() =>
                          setDraft({
                            id: m.id,
                            name: m.name,
                            email: m.email,
                            title: m.title,
                            permissions: m.permissions,
                            workspacePlan: m.workspace_plan || "",
                          })
                        }
                      >
                        Edit
                      </button>
                      {!m.has_password && m.enabled && (
                        <button disabled={busy} onClick={() => void act({ action: "resend", id: m.id })}>
                          Resend invite
                        </button>
                      )}
                      <button
                        disabled={busy}
                        onClick={() => void act({ action: "update", id: m.id, enabled: !m.enabled })}
                      >
                        {m.enabled ? "Suspend" : "Restore"}
                      </button>
                      <button className="danger" disabled={busy} onClick={() => setRemoving(m)}>
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
              {!data.staff.length && (
                <li className="tm-empty">
                  <Icon name="team" size={22} />
                  <b>No employees yet</b>
                  <p>Add a teammate to share the workload without sharing your owner account.</p>
                </li>
              )}
            </ul>
          </section>
          <p className="tm-footnote">
            <Icon name="shield" size={14} /> Team management, provider recovery tools and the owner account are always reserved to the master admin.
          </p>
        </>
      )}

      {draft && data && (
        <Modal title={draft.id ? `Edit ${draft.name}` : "Add a Zenvio employee"} onClose={() => !busy && setDraft(null)}>
          <form
            className="tm-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await act(
                draft.id
                  ? {
                      action: "update",
                      id: draft.id,
                      title: draft.title,
                      permissions: draft.permissions,
                      workspacePlan: draft.workspacePlan,
                    }
                  : {
                      action: "invite",
                      name: draft.name,
                      email: draft.email,
                      title: draft.title,
                      permissions: draft.permissions,
                      workspacePlan: draft.workspacePlan,
                    },
              );
              if (ok) setDraft(null);
            }}
          >
            {!draft.id && (
              <div className="tm-form-grid">
                <label>
                  Full name
                  <input required minLength={2} maxLength={100} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </label>
                <label>
                  Work email
                  <input type="email" required maxLength={254} value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
                </label>
              </div>
            )}
            <label>
              <span>
                Job title <span className="tm-optional">optional</span>
              </span>
              <input maxLength={80} placeholder="e.g. Customer success" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>

            <fieldset className="tm-perms">
              <legend>Console access</legend>
              <div className="tm-presets">
                {presets.map((p) => {
                  const perms = p.permissions === "all" ? all : p.permissions;
                  const on = perms.length === draft.permissions.length && perms.every((x) => draft.permissions.includes(x));
                  return (
                    <button
                      key={p.label}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setDraft({ ...draft, permissions: [...perms] })}
                    >
                      {p.label}
                    </button>
                  );
                })}
                <button type="button" onClick={() => setDraft({ ...draft, permissions: [] })}>Clear</button>
              </div>
              <div className="tm-perm-grid">
                {Object.entries(data.permissions).map(([id, p]) => {
                  const checked = draft.permissions.includes(id);
                  return (
                    <label key={id} className={`tm-perm ${checked ? "on" : ""} ${id === "integrations" ? "sensitive" : ""}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setDraft({
                            ...draft,
                            permissions: checked ? draft.permissions.filter((x) => x !== id) : [...draft.permissions, id],
                          })
                        }
                      />
                      <span>
                        <b>{p.label}</b>
                        <small>{p.description}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <label>
              Product features for their own workspace
              <select value={draft.workspacePlan} onChange={(e) => setDraft({ ...draft, workspacePlan: e.target.value })}>
                {planOptions.map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
              <small className="tm-hint">Complimentary while they are an active employee. No charge is created.</small>
            </label>

            {!draft.id && (
              <p className="tm-hint">
                {data.mail
                  ? "They'll get an email to set their password, then sign in at the usual sign-in page."
                  : "Email isn't connected, so no invite will be sent. They can use “Forgot password” once email is set up."}
              </p>
            )}
            <div className="tm-form-actions">
              <button type="button" onClick={() => setDraft(null)} disabled={busy}>Cancel</button>
              <button className="tm-primary" disabled={busy}>
                {busy ? "Saving…" : draft.id ? "Save changes" : "Add employee"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {removing && (
        <Modal title={`Remove ${removing.name}?`} onClose={() => !busy && setRemoving(null)}>
          <p>
            They lose console access and complimentary features immediately. Their personal Zenvio account and data are kept.
          </p>
          <div className="tm-form-actions">
            <button onClick={() => setRemoving(null)} disabled={busy}>Cancel</button>
            <button
              className="tm-danger"
              disabled={busy}
              onClick={async () => {
                if (await act({ action: "remove", id: removing.id })) setRemoving(null);
              }}
            >
              Remove from team
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
