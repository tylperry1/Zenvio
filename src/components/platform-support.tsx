"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Badge, Notice, PageHeader, Panel } from "./ds";

type Ticket = { id: string; subject: string; status: string; name: string; unread: number; assigned_to: string | null };
type Message = { id: string; staff: boolean; internal: boolean; content: string; created_at: string };
type Reply = { id: string; title: string; content: string };

export function PlatformSupport({ staff = false, compact = false }: { staff?: boolean; compact?: boolean }) {
  const endpoint = staff ? "/api/admin/support" : "/api/support";
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [selected, setSelected] = useState("");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [internal, setInternal] = useState(false);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const messageReference = useRef<string | null>(null);
  const selectedTicket = tickets.find((ticket) => ticket.id === selected);

  useEffect(() => {
    const ticket = new URLSearchParams(window.location.search).get("ticket");
    if (ticket) setSelected(ticket);
  }, []);
  useEffect(() => { messageReference.current = null; }, [selected, content, internal, subject]);

  useEffect(() => {
    const version = ++generation.current;
    let stopped = false;
    async function refresh() {
      try {
        const response = await fetch(endpoint + "?" + new URLSearchParams({ q: query, status, page: String(page) }), { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load support.");
        if (stopped) return;
        setTickets(data.tickets);
        setReplies(data.replies);
        setMore(data.hasMore);
        if (selected) {
          let cursor = "0";
          const history: Message[] = [];
          let hasMore = true;
          while (hasMore) {
            const result = await fetch(endpoint + "?" + new URLSearchParams({ ticket: selected, after: cursor }), { cache: "no-store" });
            const detail = await result.json();
            if (!result.ok) throw new Error(detail.error || "Unable to load conversation.");
            if (stopped || version !== generation.current) return;
            history.push(...detail.messages);
            cursor = history.at(-1)?.id ?? cursor;
            hasMore = detail.hasMore;
          }
          setMessages(history);
        } else setMessages([]);
        setError("");
      } catch (cause) {
        if (!stopped) setError(cause instanceof Error ? cause.message : "Unable to load support.");
      } finally { if (!stopped) setLoading(false); }
    }
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 10000);
    return () => { stopped = true; clearInterval(timer); };
  }, [endpoint, selected, status, query, page, busy]);

  async function post(input: object) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to send.");
      return data;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to send.");
    } finally { setBusy(false); }
  }
  return (
    <div className="ds-root">
      {!compact && <PageHeader title={staff ? "Customer support" : "Zenvio support"} description={staff ? "Customer conversations, ticket status and private team notes." : "Send a message to the Zenvio team. Your conversation stays here while the team is away."} />}
      <p><Link href="/help">Search the Help Center</Link></p>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className={compact ? "support-grid support-compact" : "support-grid"}>
        <Panel title="Conversations">
          <label className="ds-field">Search subjects<input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} maxLength={100} /></label>
          <label className="ds-field">Status<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}>
            <option value="">All</option><option value="open">Open</option><option value="pending">Pending</option><option value="resolved">Resolved</option>
          </select></label>
          {!staff && <button className="ds-btn primary" onClick={() => { setSelected(""); setContent(""); }}>New conversation</button>}
          {loading && <p role="status">Loading conversations…</p>}
          {!loading && !tickets.length && <p>No conversations match this view.</p>}
          <ul className="support-list">{tickets.map((ticket) => <li key={ticket.id}>
            <button className="ds-btn" aria-pressed={selected === ticket.id} onClick={() => { setSelected(ticket.id); setContent(""); }}>
              {ticket.subject} {ticket.unread > 0 && <Badge>{ticket.unread} unread</Badge>}
            </button>
            <small>{staff && ticket.name + " · "}{ticket.status}</small>
          </li>)}</ul>
          <div className="sc-share-actions">
            <button className="ds-btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
            <button className="ds-btn sm" disabled={!more} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </Panel>
        <Panel title={selectedTicket?.subject || (selected ? "Conversation" : "How can we help?")}>
          {selected && selectedTicket && <div className="sc-share-actions">
            {(["open", "pending", "resolved"] as const).map((value) => <button className="ds-btn sm" key={value} disabled={busy || selectedTicket.status === value}
              onClick={() => void post({ action: "update", ticket: selected, status: value })}>{value}</button>)}
            {staff && <>
              <button className="ds-btn sm" disabled={busy} onClick={() => void post({ action: "update", ticket: selected, assigned: "self" })}>Assign to me</button>
              <button className="ds-btn sm" disabled={busy || !selectedTicket.assigned_to} onClick={() => void post({ action: "update", ticket: selected, assigned: null })}>Unassign</button>
            </>}
          </div>}
          <ol className="support-history" aria-label="Conversation history">{messages.map((message) => <li className={message.internal ? "support-note" : ""} key={message.id}>
            <b>{message.internal ? "Internal note" : message.staff ? "Zenvio team" : "Customer"}</b>
            <p>{message.content}</p><small>{new Date(message.created_at).toLocaleString()}</small>
          </li>)}</ol>
          {(!staff || selected) && <form className="sc-form" onSubmit={async (event) => {
            event.preventDefault();
            messageReference.current ??= crypto.randomUUID();
            const result = await post({ action: selected ? "message" : "create", ticket: selected || undefined, subject, content, internal, reference: messageReference.current });
            if (result) { setSelected(result.id); setContent(""); setSubject(""); messageReference.current = null; }
          }}>
            {!selected && <label className="ds-field">Subject<input required maxLength={150} value={subject} onChange={(event) => setSubject(event.target.value)} /></label>}
            {staff && <label className="ds-field">Saved replies<select value="" onChange={(event) => setContent(replies.find((reply) => reply.id === event.target.value)?.content || "")}>
              <option value="">Choose a reply</option>{replies.map((reply) => <option value={reply.id} key={reply.id}>{reply.title}</option>)}
            </select></label>}
            <label className="ds-field">{internal ? "Private note" : "Message"}<textarea required maxLength={4000} rows={5} value={content} onChange={(event) => setContent(event.target.value)} /></label>
            {staff && <label><input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} /> Internal note visible to Zenvio staff</label>}
            <div className="sc-share-actions">
              <button className="ds-btn primary" disabled={busy}>{busy ? "Sending…" : internal ? "Save private note" : "Send message"}</button>
              {staff && <button type="button" className="ds-btn" disabled={busy || !content.trim()} onClick={() => {
                const title = prompt("Name this saved reply");
                if (title) void post({ action: "save-reply", title, content });
              }}>Save as reply</button>}
            </div>
          </form>}
        </Panel>
      </div>
    </div>
  );
}

export function SupportLauncher() {
  const [open, setOpen] = useState(false);
  return <>
    <button className="support-launcher ds-btn" aria-expanded={open} aria-controls="zenvio-support" onClick={() => setOpen(!open)}>Help & support</button>
    {open && <aside id="zenvio-support" className="support-popover" aria-label="Zenvio support">
      <div className="sc-share-actions"><b>Zenvio support</b><button className="ds-btn sm" onClick={() => setOpen(false)}>Close</button><Link href="/app/support" onClick={() => setOpen(false)}>Open full page</Link></div>
      <p>Leave a message and check back for a reply from our team.</p>
      <PlatformSupport compact />
    </aside>}
  </>;
}
