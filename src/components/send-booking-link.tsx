"use client";
import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { Alert, Field, Skeleton } from "./ui";
import { Modal } from "./modal";

type Client = { id: string; name: string; email: string };
type Links = { profile: string | null; links: { title: string; slug: string; url: string }[] };

// Shared "Send booking link" flow used from client profiles, appointments and booking links.
// It records the message in the client's inbox conversation and reports the real delivery state.
export function SendBookingLinkDialog({
  client: initialClient,
  slug: initialSlug,
  onClose,
  onSent,
}: {
  client?: Client;
  slug?: string;
  onClose: () => void;
  onSent?: (message: string) => void;
}) {
  const [client, setClient] = useState<Client | undefined>(initialClient),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<Client[]>([]),
    [links, setLinks] = useState<Links | null>(null),
    [slug, setSlug] = useState(initialSlug || ""),
    [channel, setChannel] = useState<"email" | "sms">("email"),
    [body, setBody] = useState(""),
    [edited, setEdited] = useState(false),
    [sms, setSms] = useState<{ ok: boolean; detail?: string } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/inbox?links=1", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setLinks(d);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (client) return;
    const t = setTimeout(() => {
      fetch(`/api/clients?q=${encodeURIComponent(query)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setResults((d.contacts || []).slice(0, 8)))
        .catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [query, client]);
  const url = slug ? links?.links.find((l) => l.slug === slug)?.url : links?.profile;
  const title = slug ? links?.links.find((l) => l.slug === slug)?.title : "";
  useEffect(() => {
    if (!client || edited || !url) return;
    setBody(`Hi ${client.name.split(" ")[0]}, you can choose a time that works for you here:\n\n${title ? title + ": " : ""}${url}`);
  }, [client, url, title, edited]);
  useEffect(() => {
    if (!client) return;
    // SMS readiness comes from the client's conversation (consent, number, provider).
    fetch(`/api/inbox?sms=${client.id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setSms(d))
      .catch(() => setSms({ ok: false }));
  }, [client]);
  async function send() {
    if (!client) return;
    setBusy(true);
    setError("");
    try {
      const start = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", contactId: client.id }),
      });
      const thread = await start.json();
      if (!start.ok) throw Error(thread.error);
      const r = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", threadId: thread.id, channel, body }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      onSent?.(
        d.status === "queued"
          ? `Booking link queued for email to ${client.name}. Delivery status is in the inbox.`
          : `Booking link sent to ${client.name}.`,
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The link couldn’t be sent.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Send booking link" onClose={onClose}>
      <div className="ui-form sbl">
        {error && <Alert tone="danger">{error}</Alert>}
        {client ? (
          <div className="sbl-client">
            <span className="sbl-avatar">{client.name.slice(0, 1).toUpperCase()}</span>
            <div>
              <b>{client.name}</b>
              <small>{client.email}</small>
            </div>
            {!initialClient && (
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setClient(undefined)}>
                Change
              </button>
            )}
          </div>
        ) : (
          <Field label="Client">
            <input
              className="ui-input"
              autoFocus
              placeholder="Search clients by name or email"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <ul className="sbl-results" role="listbox" aria-label="Matching clients">
              {results.map((c) => (
                <li key={c.id}>
                  <button type="button" role="option" aria-selected={false} onClick={() => setClient(c)}>
                    <b>{c.name}</b> <small>{c.email}</small>
                  </button>
                </li>
              ))}
              {!results.length && <li className="sbl-none">No matching clients. Add them on the Clients page first.</li>}
            </ul>
          </Field>
        )}
        {!links ? (
          <Skeleton rows={2} />
        ) : (
          <Field label="Link">
            <select className="ui-input" value={slug} onChange={(e) => setSlug(e.target.value)}>
              <option value="">All appointment types (profile page)</option>
              {links.links.map((l) => (
                <option key={l.slug} value={l.slug}>
                  {l.title}
                </option>
              ))}
            </select>
          </Field>
        )}
        <fieldset className="sbl-channel">
          <legend className="ui-label">Send by</legend>
          <label>
            <input type="radio" name="sbl-channel" checked={channel === "email"} onChange={() => setChannel("email")} /> Email
          </label>
          <label className={sms?.ok ? "" : "disabled"}>
            <input
              type="radio"
              name="sbl-channel"
              disabled={!sms?.ok}
              checked={channel === "sms"}
              onChange={() => setChannel("sms")}
            />{" "}
            Text message
          </label>
        </fieldset>
        {client && sms && !sms.ok && sms.detail && <p className="ui-hint">{sms.detail}</p>}
        <Field label="Message" hint={channel === "email" ? "Emails include a link to the client’s portal." : undefined}>
          <textarea
            className="ui-input"
            rows={5}
            maxLength={channel === "sms" ? 600 : 5000}
            value={body}
            onChange={(e) => {
              setEdited(true);
              setBody(e.target.value);
            }}
          />
        </Field>
        <div className="ui-modal-actions">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="ui-btn ui-btn-primary" disabled={busy || !client || !body.trim() || !url} onClick={() => void send()}>
            <Icon name="send" size={15} /> {busy ? "Sending…" : "Send link"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
