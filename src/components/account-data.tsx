"use client";
import Link from "next/link";
import { useState } from "react";
import { Icon } from "./icons";
import { Modal } from "./modal";

type Blocker = { id: string; message: string; href?: string };

export function AccountData() {
  const [open, setOpen] = useState(false);
  const [blockers, setBlockers] = useState<Blocker[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function start() {
    setOpen(true);
    setError("");
    setBlockers(null);
    try {
      const r = await fetch("/api/account", { cache: "no-store" }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      setBlockers(d.blockers);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="panel account-data" aria-labelledby="account-data-title">
      <h2 id="account-data-title">Your data</h2>
      <p>
        Download everything in your workspace — profile, appointment types, appointments, clients, and
        document and payment history — as a JSON file.
      </p>
      <a className="button secondary small" href="/api/account?export=json">
        <Icon name="download" size={15} /> Download my data
      </a>
      <div className="account-danger">
        <div>
          <b>Delete account</b>
          <small>Permanently remove your account, booking page, appointments, and clients.</small>
        </div>
        <button className="button small account-delete" onClick={() => void start()}>
          Delete account…
        </button>
      </div>
      {open && (
        <Modal title="Delete your account?" onClose={() => !busy && setOpen(false)}>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          {!blockers ? (
            !error && <p>Checking your account…</p>
          ) : blockers.length ? (
            <div className="account-blockers">
              <p>A few things need attention before this account can be deleted:</p>
              <ul>
                {blockers.map((b) => (
                  <li key={b.id}>
                    <span>{b.message}</span>
                    {b.href && (
                      <Link href={b.href} onClick={() => setOpen(false)}>
                        Open
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
              <p className="helper-text">
                You can download your data at any time.
              </p>
            </div>
          ) : (
            <form
              className="stack-form account-delete-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setBusy(true);
                setError("");
                try {
                  const r = await fetch("/api/account", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "delete",
                        confirm: f.get("confirm"),
                        password: f.get("password"),
                      }),
                    }),
                    d = await r.json();
                  if (!r.ok) throw Error(d.error);
                  window.location.assign("/?account=deleted");
                } catch (err) {
                  setError((err as Error).message);
                  setBusy(false);
                }
              }}
            >
              <p>
                This can’t be undone. Your booking page stops working immediately, and your appointment types,
                appointments, clients, and settings are permanently deleted. Consider downloading your data first.
              </p>
              <label>
                Current password
                <input name="password" type="password" autoComplete="current-password" required />
              </label>
              <label>
                Type DELETE to confirm
                <input name="confirm" required pattern="DELETE" autoComplete="off" />
              </label>
              <div className="link-prompt-actions">
                <button type="button" className="button secondary small" disabled={busy} onClick={() => setOpen(false)}>
                  Keep my account
                </button>
                <button className="button small account-delete" disabled={busy}>
                  {busy ? "Deleting…" : "Delete account"}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </section>
  );
}
