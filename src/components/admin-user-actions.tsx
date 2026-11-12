"use client";
import { Modal } from "./modal";
import {useEffect,useState} from "react";
export function AdminUserActions({ account, onUpdated, onDeleted }: {
  account: { id: string; name: string; email: string; timezone: string; role: string };
  onUpdated: () => void; onDeleted: () => void;
}) {
  const [mode, setMode] = useState<"edit" | "delete" | "deactivate" | "reactivate" | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [deactivated,setDeactivated]=useState(false);
  useEffect(()=>{fetch("/api/admin/users?id="+account.id).then(r=>r.ok?r.json():null).then(d=>setDeactivated(Boolean(d?.deactivated_at))).catch(()=>{});},[account.id]);
  if (account.role === "master_admin") return <p>Master admin accounts are protected. Update your profile in user Settings.</p>;
  return <section aria-label="Manage user">
    <h3>Manage user</h3>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <button type="button" className="button small" disabled={busy} onClick={() => { setMode("edit"); setError(""); setMessage(""); }}>Edit user</button>
      <button type="button" className="button small" disabled={busy} onClick={() => { setMode("delete"); setError(""); setMessage(""); }}>Delete user</button>
    </div>
    <button type="button" className="button small" disabled={busy} onClick={()=>{setMode(deactivated?"reactivate":"deactivate");setError("");}}>{deactivated?"Reactivate account":"Deactivate account"}</button>
    {mode && <Modal title={mode==="delete"?"Delete user":mode==="edit"?"Edit user":mode==="deactivate"?"Deactivate account":"Reactivate account"} onClose={()=>!busy&&setMode(null)}><form className="stack-form" onSubmit={async e => {
      e.preventDefault(); if (busy) return;
      const f = new FormData(e.currentTarget); setBusy(true); setError(""); setMessage("");
      try {
        const r = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: mode, id: account.id, name: f.get("name"), email: f.get("email"), timezone: f.get("timezone"), reason: f.get("reason"), confirmation: f.get("confirmation") }) });
        const d = await r.json(); if (!r.ok) throw new Error(d.error || "Unable to update user.");
        setMessage(d.message); setMode(null);setDeactivated(mode==="deactivate");
        if (mode === "delete") onDeleted(); else onUpdated();
      } catch (e) { setError(e instanceof Error ? e.message : "Unable to update user."); } finally { setBusy(false); }
    }}>
      {mode === "edit" ? <>
        <label>Name<input name="name" defaultValue={account.name} required minLength={2} maxLength={100} disabled={busy} /></label>
        <label>Email<input name="email" type="email" defaultValue={account.email} required maxLength={254} disabled={busy} /></label>
        <label>Timezone<input name="timezone" defaultValue={account.timezone} required maxLength={100} placeholder="America/New_York" disabled={busy} /></label>
        <p>Changing email signs this user out and clears email verification. Timezone changes affect future availability; existing appointment times stay unchanged.</p>
      </> : mode === "delete" ? <>
        <p>Permanently delete this user's account, booking links, contacts, and appointment history. This cannot be undone. Existing Google Calendar events are not removed. Users with billing or marketplace history cannot be permanently deleted.</p>
        <label>Type {account.email} to confirm<input name="confirmation" required autoComplete="off" disabled={busy} /></label>
      </> : <p>{mode==="deactivate"?"This revokes all sessions and blocks sign-in. Billing is not cancelled and financial and legal history is retained.":"Allow this user to sign in again. Previous sessions remain revoked."}</p>}
      <label>Reason<textarea name="reason" required minLength={5} maxLength={500} rows={2} disabled={busy} /></label>
      <div style={{ display: "flex", gap: 12 }}>
        <button className="button primary small" disabled={busy}>{busy ? "Saving…" : mode === "edit" ? "Save user" : mode==="delete"?"Permanently delete user":mode==="deactivate"?"Deactivate account":"Reactivate account"}</button>
        <button type="button" className="button small" disabled={busy} onClick={() => setMode(null)}>Cancel</button>
      </div>
    {error&&<p role="alert">{error}</p>}</form></Modal>}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
