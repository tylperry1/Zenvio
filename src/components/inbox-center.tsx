"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Icon } from "./icons";
import { AskZenvio } from "./assistant";
import { SendBookingLinkDialog } from "./send-booking-link";
import { Alert, Badge, EmptyState, Field, Skeleton, Tabs, formatDateTime, useToast } from "./ui";
import { Modal } from "./modal";

type Thread = {
  id: string;
  subject: string;
  status: "open" | "closed";
  assigned_to: string | null;
  assigned_name: string | null;
  last_message_at: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  unread: number;
  last: { body: string; direction: string; channel: string } | null;
};
type Attachment = { id: string; filename: string; content_type: string; size: number };
type Message = {
  id: string;
  direction: "inbound" | "outbound" | "internal";
  channel: "email" | "sms" | "portal" | "note";
  author_name: string;
  body: string;
  status: string;
  status_detail: string;
  created_at: string;
  attachments: Attachment[];
};
type Detail = {
  thread: {
    id: string;
    subject: string;
    status: "open" | "closed";
    assigned_to: string | null;
    contact: { id: string; name: string; email: string; phone: string } | null;
  };
  messages: Message[];
  sms: { ok: boolean; sender?: string; reason?: string; detail?: string };
};
type Template = { id: string; name: string; body: string };
type Filter = "all" | "unread" | "mine" | "open" | "closed";

const statusTone: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  queued: "info",
  sent: "success",
  delivered: "success",
  received: "neutral",
  failed: "danger",
  uncertain: "warning",
  blocked: "warning",
};
const statusLabel: Record<string, string> = {
  queued: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  failed: "Not delivered",
  uncertain: "Check delivery",
  blocked: "Blocked",
};
const channelLabel = { email: "Email", sms: "Text", portal: "Client portal", note: "Internal note" };

export function InboxCenter() {
  const params = useSearchParams();
  const [filter, setFilter] = useState<Filter>("all"),
    [query, setQuery] = useState(""),
    [list, setList] = useState<{ threads: Thread[]; members: { id: string; name: string; email: string }[]; templates: Template[]; unread: number } | null>(null),
    [listError, setListError] = useState(""),
    [selected, setSelected] = useState<string | null>(params.get("thread")),
    [detail, setDetail] = useState<Detail | null>(null),
    [detailError, setDetailError] = useState(""),
    [picker, setPicker] = useState(false),
    [shareLink, setShareLink] = useState(false);
  const toast = useToast();

  const loadList = useCallback(async () => {
    try {
      const r = await fetch(`/api/inbox?filter=${filter}&q=${encodeURIComponent(query)}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setList(d);
      setListError("");
    } catch (e) {
      setListError(e instanceof Error ? e.message : "The inbox couldn’t be loaded.");
    }
  }, [filter, query]);
  const loadThread = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/inbox?thread=${id}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setDetail(d);
      setDetailError("");
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "The conversation couldn’t be loaded.");
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void loadList(), query ? 250 : 0);
    return () => clearTimeout(t);
  }, [loadList, query]);
  useEffect(() => {
    if (!selected) return setDetail(null);
    setDetail(null);
    void loadThread(selected).then(() => loadList());
    window.history.replaceState(null, "", `/app/inbox?thread=${selected}`);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // New client messages arrive through the portal; refresh quietly while the page is open.
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadList();
      if (selected) void loadThread(selected);
    }, 30000);
    return () => clearInterval(timer);
  }, [loadList, loadThread, selected]);

  async function post(payload: Record<string, unknown>) {
    const r = await fetch("/api/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    return d;
  }
  async function startWith(contactId: string) {
    try {
      const d = await post({ action: "start", contactId });
      setPicker(false);
      setSelected(d.id);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Couldn’t open a conversation.", true);
    }
  }
  useEffect(() => {
    const contact = params.get("contact");
    if (contact) void startWith(contact);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="platform-page inbox-page">
      <div className="inbox-head">
        <div>
          <h1>Inbox</h1>
          <p>Every client conversation in one place — email, text, portal replies and internal notes.</p>
        </div>
        <div className="inbox-head-actions">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setShareLink(true)}>
            <Icon name="link" size={15} /> Send booking link
          </button>
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => setPicker(true)}>
            <Icon name="plus" size={15} /> New conversation
          </button>
        </div>
      </div>
      <div className={`inbox${selected ? " has-thread" : ""}`}>
        <section className="inbox-list" aria-label="Conversations">
          <div className="inbox-list-tools">
            <div className="inbox-search">
              <Icon name="search" size={15} />
              <input
                type="search"
                placeholder="Search conversations"
                aria-label="Search conversations"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Tabs<Filter>
              label="Filter conversations"
              value={filter}
              onChange={setFilter}
              tabs={[
                { id: "all", label: "All" },
                { id: "unread", label: "Unread", count: list?.unread || undefined },
                { id: "mine", label: "Assigned to me" },
                { id: "closed", label: "Closed" },
              ]}
            />
          </div>
          {listError && <Alert tone="danger">{listError}</Alert>}
          {!list && !listError && <Skeleton rows={6} />}
          {list && !list.threads.length && (
            <EmptyState icon="message" title={query || filter !== "all" ? "No matching conversations" : "No conversations yet"}>
              {query || filter !== "all"
                ? "Try another search or filter."
                : "Start one with a client, or send a booking link. Client replies from their portal land here."}
            </EmptyState>
          )}
          <ul className="inbox-threads">
            {list?.threads.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={`inbox-thread${t.id === selected ? " active" : ""}${t.unread ? " unread" : ""}`}
                  onClick={() => setSelected(t.id)}
                  aria-current={t.id === selected ? "true" : undefined}
                >
                  <span className="inbox-avatar" aria-hidden="true">
                    {(t.contact_name || t.subject || "?").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="inbox-thread-main">
                    <span className="inbox-thread-top">
                      <b>{t.contact_name || t.subject || "Conversation"}</b>
                      <time>{formatDateTime(t.last_message_at)}</time>
                    </span>
                    <span className="inbox-thread-preview">
                      {t.last ? (
                        <>
                          {t.last.direction === "outbound" && "You: "}
                          {t.last.direction === "internal" && "Note: "}
                          {t.last.body}
                        </>
                      ) : (
                        "No messages yet"
                      )}
                    </span>
                    <span className="inbox-thread-meta">
                      {t.status === "closed" && <Badge>Closed</Badge>}
                      {t.assigned_name && <Badge tone="info">{t.assigned_name}</Badge>}
                    </span>
                  </span>
                  {t.unread > 0 && (
                    <span className="inbox-unread" aria-label={`${t.unread} unread`}>
                      {t.unread}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="inbox-view" aria-label="Conversation">
          {!selected ? (
            <EmptyState icon="message" title="Select a conversation">
              Choose a conversation to read and reply.
            </EmptyState>
          ) : detailError ? (
            <div className="inbox-pad">
              <Alert tone="danger">{detailError}</Alert>
            </div>
          ) : !detail ? (
            <div className="inbox-pad">
              <Skeleton rows={5} />
            </div>
          ) : (
            <ThreadView
              detail={detail}
              members={list?.members || []}
              templates={list?.templates || []}
              onBack={() => setSelected(null)}
              onChange={async () => {
                await loadThread(detail.thread.id);
                await loadList();
              }}
              post={post}
              notify={toast.show}
            />
          )}
        </section>
      </div>
      {picker && <ClientPicker onPick={startWith} onClose={() => setPicker(false)} />}
      {shareLink && (
        <SendBookingLinkDialog
          onClose={() => setShareLink(false)}
          onSent={(m) => {
            toast.show(m);
            void loadList();
          }}
        />
      )}
      {toast.node}
    </div>
  );
}

function ThreadView({
  detail,
  members,
  templates,
  onBack,
  onChange,
  post,
  notify,
}: {
  detail: Detail;
  members: { id: string; name: string; email: string }[];
  templates: Template[];
  onBack: () => void;
  onChange: () => Promise<void>;
  post: (p: Record<string, unknown>) => Promise<any>;
  notify: (text: string, error?: boolean) => void;
}) {
  const { thread, messages, sms } = detail;
  const contact = thread.contact;
  const scroller = useRef<HTMLDivElement>(null);
  const [shareLink, setShareLink] = useState(false);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages.length]);
  return (
    <>
      <header className="inbox-view-head">
        <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon ui-btn-sm inbox-back" aria-label="Back to conversations" onClick={onBack}>
          <Icon name="arrow" size={16} style={{ transform: "rotate(180deg)" }} />
        </button>
        <div className="inbox-view-title">
          <b>{contact?.name || thread.subject || "Conversation"}</b>
          {contact && (
            <small>
              {contact.email}
              {contact.phone && ` · ${contact.phone}`}
            </small>
          )}
        </div>
        <div className="inbox-view-actions">
          {contact && (
            <>
              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setShareLink(true)}>
                <Icon name="link" size={14} /> Booking link
              </button>
              <AskZenvio
                className="ui-btn ui-btn-ghost ui-btn-sm"
                label="Ask Zenvio"
                context={{ type: "client", id: contact.id, label: contact.name }}
                prompt="Draft a reply to this client's latest message."
              />
              <Link className="ui-btn ui-btn-ghost ui-btn-sm" href={`/app/clients?client=${contact.id}`}>
                Profile
              </Link>
            </>
          )}
          {members.length > 1 && (
            <select
              className="ui-input inbox-assign"
              aria-label="Assign conversation"
              value={thread.assigned_to || ""}
              onChange={async (e) => {
                try {
                  await post({ action: "assign", threadId: thread.id, userId: e.target.value || null });
                  await onChange();
                } catch (err) {
                  notify(err instanceof Error ? err.message : "Couldn’t assign.", true);
                }
              }}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.email}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="ui-btn ui-btn-ghost ui-btn-sm"
            onClick={async () => {
              try {
                await post({ action: "status", threadId: thread.id, status: thread.status === "open" ? "closed" : "open" });
                await onChange();
              } catch (err) {
                notify(err instanceof Error ? err.message : "Couldn’t update.", true);
              }
            }}
          >
            {thread.status === "open" ? "Close" : "Reopen"}
          </button>
        </div>
      </header>
      <div className="inbox-messages" ref={scroller} role="log" aria-label="Messages">
        {!messages.length && <p className="inbox-empty-thread">No messages yet. Write the first one below.</p>}
        {messages.map((m) => (
          <article key={m.id} className={`inbox-msg inbox-msg-${m.direction}`}>
            <div className="inbox-msg-bubble">
              <p>{m.body}</p>
              {m.attachments.length > 0 && (
                <ul className="inbox-attachments">
                  {m.attachments.map((a) => (
                    <li key={a.id}>
                      <a href={`/api/inbox/attachments?id=${a.id}`}>
                        <Icon name="paperclip" size={13} /> {a.filename}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <footer>
              <span>
                {m.direction === "inbound" ? contact?.name || "Client" : m.author_name || "You"} · {channelLabel[m.channel]} ·{" "}
                {formatDateTime(m.created_at)}
              </span>
              {m.direction === "outbound" && (
                <Badge tone={statusTone[m.status] || "neutral"}>{statusLabel[m.status] || m.status}</Badge>
              )}
            </footer>
            {m.status_detail && m.direction === "outbound" && <small className="inbox-msg-detail">{m.status_detail}</small>}
          </article>
        ))}
      </div>
      <Composer thread={thread.id} hasContact={!!contact} sms={sms} templates={templates} post={post} onSent={onChange} notify={notify} />
      {shareLink && contact && (
        <SendBookingLinkDialog
          client={contact}
          onClose={() => setShareLink(false)}
          onSent={async (m) => {
            notify(m);
            await onChange();
          }}
        />
      )}
    </>
  );
}

function Composer({
  thread,
  hasContact,
  sms,
  templates,
  post,
  onSent,
  notify,
}: {
  thread: string;
  hasContact: boolean;
  sms: Detail["sms"];
  templates: Template[];
  post: (p: Record<string, unknown>) => Promise<any>;
  onSent: () => Promise<void>;
  notify: (text: string, error?: boolean) => void;
}) {
  const [channel, setChannel] = useState<"email" | "sms" | "note">(hasContact ? "email" : "note"),
    [body, setBody] = useState(""),
    [portal, setPortal] = useState(true),
    [files, setFiles] = useState<Attachment[]>([]),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState<"" | "templates" | "links">(""),
    [links, setLinks] = useState<{ profile: string | null; links: { title: string; url: string }[] } | null>(null),
    [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const draftKey = "zenvio-draft:" + thread;
  useEffect(() => {
    try {
      setBody(localStorage.getItem(draftKey) || "");
    } catch {}
  }, [draftKey]);
  useEffect(() => {
    try {
      if (body) localStorage.setItem(draftKey, body);
      else localStorage.removeItem(draftKey);
    } catch {}
  }, [body, draftKey]);
  useEffect(() => {
    if (menu === "links" && !links)
      fetch("/api/inbox?links=1", { cache: "no-store" })
        .then((r) => r.json())
        .then(setLinks)
        .catch(() => notify("Couldn’t load links.", true));
  }, [menu]); // eslint-disable-line react-hooks/exhaustive-deps
  const insert = (text: string) => {
    setBody((b) => (b ? b.replace(/\s*$/, "") + "\n\n" : "") + text);
    setMenu("");
  };
  async function upload(file: File) {
    if (files.length >= 5) return notify("Attach up to five files.", true);
    try {
      const r = await fetch(`/api/inbox/attachments?thread=${thread}&name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setFiles((f) => [...f, d]);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Upload failed.", true);
    }
  }
  async function send() {
    setBusy(true);
    try {
      const d = await post({
        action: "send",
        threadId: thread,
        channel,
        body,
        attachmentIds: files.map((f) => f.id),
        includePortalLink: portal,
      });
      setBody("");
      setFiles([]);
      notify(channel === "note" ? "Note added." : d.status === "queued" ? "Message queued for delivery." : "Message sent.");
      await onSent();
    } catch (e) {
      notify(e instanceof Error ? e.message : "The message couldn’t be sent.", true);
    } finally {
      setBusy(false);
    }
  }
  const max = channel === "sms" ? 600 : 5000;
  return (
    <div className={`inbox-composer${channel === "note" ? " note" : ""}`}>
      <div className="inbox-composer-channels" role="radiogroup" aria-label="Send as">
        {hasContact && (
          <button type="button" role="radio" aria-checked={channel === "email"} className={channel === "email" ? "active" : ""} onClick={() => setChannel("email")}>
            <Icon name="mail" size={14} /> Email
          </button>
        )}
        {hasContact && (
          <button
            type="button"
            role="radio"
            aria-checked={channel === "sms"}
            className={channel === "sms" ? "active" : ""}
            disabled={!sms.ok}
            title={sms.ok ? `From ${sms.sender}` : sms.detail}
            onClick={() => setChannel("sms")}
          >
            <Icon name="message" size={14} /> Text
          </button>
        )}
        <button type="button" role="radio" aria-checked={channel === "note"} className={channel === "note" ? "active" : ""} onClick={() => setChannel("note")}>
          <Icon name="file" size={14} /> Internal note
        </button>
      </div>
      {hasContact && !sms.ok && channel !== "note" && <p className="inbox-composer-hint">Text messages: {sms.detail}</p>}
      {channel === "sms" && sms.ok && (
        <p className="inbox-composer-hint">
          Sends from {sms.sender}. Only text clients who agreed to receive texts; replies of STOP are honored automatically.
        </p>
      )}
      <textarea
        className="ui-input"
        rows={3}
        maxLength={max}
        value={body}
        aria-label="Message"
        placeholder={channel === "note" ? "Visible only to your team" : "Write a message…"}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim() && !busy) void send();
        }}
      />
      {files.length > 0 && (
        <ul className="inbox-files">
          {files.map((f) => (
            <li key={f.id}>
              <Icon name="paperclip" size={13} /> {f.filename}
              <button type="button" aria-label={`Remove ${f.filename}`} onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}>
                <Icon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="inbox-composer-bar">
        <div className="inbox-composer-tools">
          <div className="inbox-menu">
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" aria-expanded={menu === "templates"} onClick={() => setMenu(menu === "templates" ? "" : "templates")}>
              Templates
            </button>
            {menu === "templates" && (
              <div className="inbox-popover" role="menu">
                {!templates.length && <p>No templates yet. Write a message and save it as one.</p>}
                {templates.map((t) => (
                  <div key={t.id} className="inbox-popover-row">
                    <button type="button" role="menuitem" onClick={() => insert(t.body)}>
                      {t.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete template ${t.name}`}
                      onClick={async () => {
                        await post({ action: "template-delete", id: t.id }).catch(() => {});
                        await onSent();
                      }}
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                ))}
                {body.trim() && (
                  <button type="button" className="inbox-popover-save" onClick={() => setSaving(true)}>
                    <Icon name="plus" size={13} /> Save current message as template
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="inbox-menu">
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" aria-expanded={menu === "links"} onClick={() => setMenu(menu === "links" ? "" : "links")}>
              Insert link
            </button>
            {menu === "links" && (
              <div className="inbox-popover" role="menu">
                {!links && <Skeleton rows={2} />}
                {links?.profile && (
                  <button type="button" role="menuitem" onClick={() => insert(`Book a time: ${links.profile}`)}>
                    <Icon name="calendar" size={13} /> Booking page (all types)
                  </button>
                )}
                {links?.links.map((l) => (
                  <button key={l.url} type="button" role="menuitem" onClick={() => insert(`${l.title}: ${l.url}`)}>
                    <Icon name="link" size={13} /> {l.title}
                  </button>
                ))}
                {links && <p>Documents, estimates and payment requests are in the client portal link that emails include.</p>}
              </div>
            )}
          </div>
          {channel !== "sms" && (
            <>
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => fileInput.current?.click()}>
                <Icon name="paperclip" size={14} /> Attach
              </button>
              <input
                ref={fileInput}
                type="file"
                hidden
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = "";
                }}
              />
            </>
          )}
          {channel === "email" && (
            <label className="inbox-portal-toggle">
              <input type="checkbox" checked={portal} onChange={(e) => setPortal(e.target.checked)} /> Include portal link
            </label>
          )}
        </div>
        <button type="button" className="ui-btn ui-btn-primary" disabled={busy || !body.trim()} onClick={() => void send()}>
          <Icon name="send" size={15} /> {busy ? "Sending…" : channel === "note" ? "Add note" : "Send"}
        </button>
      </div>
      {saving && (
        <TemplateDialog
          body={body}
          onClose={() => setSaving(false)}
          onSave={async (name) => {
            await post({ action: "template-save", name, body });
            setSaving(false);
            setMenu("");
            notify("Template saved.");
            await onSent();
          }}
        />
      )}
    </div>
  );
}

function TemplateDialog({ body, onClose, onSave }: { body: string; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(""),
    [error, setError] = useState("");
  return (
    <Modal title="Save as template" onClose={onClose}>
      <form
        className="ui-form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await onSave(name);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn’t save.");
          }
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Template name">
          <input className="ui-input" autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <p className="ui-hint inbox-template-preview">{body.slice(0, 300)}</p>
        <div className="ui-modal-actions">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="ui-btn ui-btn-primary" disabled={!name.trim()}>
            Save template
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ClientPicker({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState(""),
    [results, setResults] = useState<{ id: string; name: string; email: string }[] | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`/api/clients?q=${encodeURIComponent(q)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setResults((d.contacts || []).slice(0, 10)))
        .catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <Modal title="New conversation" onClose={onClose}>
      <div className="ui-form">
        <Field label="Client">
          <input className="ui-input" autoFocus placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        {!results && <Skeleton rows={3} />}
        <ul className="sbl-results">
          {results?.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onPick(c.id)}>
                <b>{c.name}</b> <small>{c.email}</small>
              </button>
            </li>
          ))}
          {results && !results.length && (
            <li className="sbl-none">
              No clients found. <Link href="/app/clients?new=1">Add a client</Link>
            </li>
          )}
        </ul>
      </div>
    </Modal>
  );
}
