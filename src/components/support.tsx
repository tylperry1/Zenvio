"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { supportCategories, supportCategoryLabel } from "@/lib/support-options";
import { Badge, EmptyState, Notice, PageHeader, Skeleton, relativeTime, type Tone } from "./ds";
import { Icon } from "./icons";

export type SupportMessage = {
  id: string;
  author_role: "customer" | "staff" | "system";
  body: string;
  created_at: string;
  author?: string | null;
  internal?: boolean;
};
type Conversation = {
  id: string;
  subject: string;
  category: string;
  status: "open" | "waiting" | "resolved";
  last_message_at: string;
  created_at: string;
  rating: number | null;
  preview?: string;
  unread?: number;
};

export const supportStatusInfo: Record<string, { label: string; tone: Tone }> = {
  open: { label: "Waiting on Zenvio", tone: "info" },
  waiting: { label: "Replied", tone: "warning" },
  resolved: { label: "Resolved", tone: "success" },
};

const time = (s: string) => new Date(s).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const day = (s: string) => new Date(s).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

/** Polls while the tab is visible. */
export function usePoll(fn: () => void, ms: number, active = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") ref.current();
    }, ms);
    const wake = () => document.visibilityState === "visible" && ref.current();
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [ms, active]);
}

/** Message list shared by the customer chat and the employee console. */
export function MessageList({ messages, perspective }: { messages: SupportMessage[]; perspective: "customer" | "staff" }) {
  const box = useRef<HTMLDivElement>(null);
  const count = messages.length;
  // Scroll only the message list, never the page around it.
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [count]);
  let lastDay = "";
  return (
    <div className="sp-messages" role="log" aria-live="polite" aria-label="Conversation" ref={box}>
      {messages.map((m) => {
        const d = day(m.created_at);
        const divider = d !== lastDay ? <p className="sp-day">{(lastDay = d)}</p> : null;
        if (m.author_role === "system")
          return (
            <div key={m.id}>
              {divider}
              <p className="sp-system">
                {m.body} · {time(m.created_at)}
              </p>
            </div>
          );
        const mine = perspective === "customer" ? m.author_role === "customer" : m.author_role === "staff";
        return (
          <div key={m.id}>
            {divider}
            <div className={`sp-msg ${mine ? "mine" : "theirs"} ${m.internal ? "internal" : ""}`}>
              <span className="sp-meta">
                {m.internal ? "Internal note · " : ""}
                {m.author_role === "staff" ? m.author || "Zenvio" : perspective === "customer" ? "You" : m.author || "Customer"} · {time(m.created_at)}
              </span>
              <p>{m.body}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Composer({
  onSend,
  placeholder = "Write a message…",
  disabled,
  extra,
}: {
  onSend: (text: string) => Promise<boolean>;
  placeholder?: string;
  disabled?: boolean;
  extra?: ReactNode;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    if (await onSend(text.trim())) setText("");
    setBusy(false);
  }
  return (
    <form
      className="sp-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <textarea
        aria-label="Message"
        rows={2}
        maxLength={4000}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <div className="sp-composer-row">
        {extra}
        <button type="submit" className="ds-btn primary sm" disabled={busy || disabled || !text.trim()}>
          <Icon name="send" size={14} /> {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}

async function post(data: Record<string, unknown>) {
  const r = await fetch("/api/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || "Something went wrong. Please try again.");
  return d;
}

function Availability({ online }: { online: boolean | null }) {
  if (online === null) return null;
  return (
    <p className={`sp-availability ${online ? "online" : ""}`}>
      <i aria-hidden="true" />
      {online ? "The team is online — replies usually arrive in minutes." : "We’re away right now. Leave a message and we’ll email you when we reply."}
    </p>
  );
}

function NewConversation({ onCreated, compact }: { onCreated: (id: string) => void; compact?: boolean }) {
  const [category, setCategory] = useState("other"),
    [subject, setSubject] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="sp-new"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const d = await post({ category, subject, message, page: window.location.pathname });
          onCreated(d.id);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Your message couldn’t be sent.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && <Notice tone="danger">{error}</Notice>}
      <label className="ds-field">
        <span>Topic</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {supportCategories.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="ds-field">
        <span>Subject</span>
        <input required maxLength={160} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="A few words about what you need" />
      </label>
      <label className="ds-field">
        <span>How can we help?</span>
        <textarea required rows={compact ? 4 : 6} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} />
        <small>Don’t include passwords, full card numbers or clients’ sensitive information.</small>
      </label>
      <button className="ds-btn primary" disabled={busy}>
        <Icon name="send" size={15} /> {busy ? "Sending…" : "Start conversation"}
      </button>
    </form>
  );
}

function Rating({ conversation, onRated }: { conversation: Conversation; onRated: () => void }) {
  const [error, setError] = useState("");
  if (conversation.rating)
    return (
      <p className="sp-rated">
        You rated this conversation {conversation.rating} out of 5. Thank you.
      </p>
    );
  return (
    <div className="sp-rating">
      <span>How did we do?</span>
      <div role="group" aria-label="Rate this conversation">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} out of 5`}
            onClick={async () => {
              try {
                await post({ conversation: conversation.id, action: "rate", rating: n });
                onRated();
              } catch (e) {
                setError(e instanceof Error ? e.message : "");
              }
            }}
          >
            <span aria-hidden="true">★</span>
          </button>
        ))}
      </div>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}

function Thread({ id, onBack, onChange }: { id: string; onBack: () => void; onChange: () => void }) {
  const [data, setData] = useState<{ conversation: Conversation; messages: SupportMessage[]; online: boolean } | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const r = await fetch(`/api/support?conversation=${id}`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setError(d.error || "This conversation couldn’t be loaded.");
    setData(d);
    // Reading a thread clears its unread count; let the top-bar badge catch up.
    window.dispatchEvent(new Event("zenvio:support-read"));
  }, [id]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);
  usePoll(load, 5000);
  if (error)
    return (
      <div className="sp-thread">
        <Notice tone="danger">{error}</Notice>
      </div>
    );
  if (!data)
    return (
      <div className="sp-thread" aria-busy="true">
        <Skeleton height={20} width="50%" />
        <Skeleton height={60} />
      </div>
    );
  const c = data.conversation;
  return (
    <div className="sp-thread">
      <header className="sp-thread-head">
        <button type="button" className="sp-back" onClick={onBack} aria-label="Back to conversations">
          <Icon name="chevron" size={14} />
        </button>
        <div>
          <h2>{c.subject}</h2>
          <p>
            {supportCategoryLabel(c.category)} · started {relativeTime(c.created_at)}
          </p>
        </div>
        <Badge tone={supportStatusInfo[c.status].tone}>{supportStatusInfo[c.status].label}</Badge>
      </header>
      <MessageList messages={data.messages} perspective="customer" />
      {c.status === "resolved" && <Rating conversation={c} onRated={load} />}
      <Composer
        placeholder={c.status === "resolved" ? "Reply to reopen this conversation…" : "Write a message…"}
        onSend={async (message) => {
          try {
            await post({ conversation: c.id, message });
            await load();
            onChange();
            return true;
          } catch (e) {
            setError(e instanceof Error ? e.message : "");
            return false;
          }
        }}
        extra={
          c.status !== "resolved" ? (
            <button
              type="button"
              className="ds-btn ghost sm"
              onClick={async () => {
                await post({ conversation: c.id, action: "resolve" }).catch(() => {});
                await load();
                onChange();
              }}
            >
              <Icon name="check" size={14} /> Mark resolved
            </button>
          ) : null
        }
      />
    </div>
  );
}

function ConversationList({ items, active, onOpen }: { items: Conversation[]; active?: string | null; onOpen: (id: string) => void }) {
  return (
    <ul className="sp-list">
      {items.map((c) => (
        <li key={c.id}>
          <button type="button" className={active === c.id ? "active" : ""} onClick={() => onOpen(c.id)}>
            <span className="sp-list-top">
              <b>{c.subject}</b>
              <small>{relativeTime(c.last_message_at)}</small>
            </span>
            <span className="sp-list-preview">{c.preview}</span>
            <span className="sp-list-tags">
              <Badge tone={supportStatusInfo[c.status].tone}>{supportStatusInfo[c.status].label}</Badge>
              {!!c.unread && <span className="sp-unread">{c.unread} new</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function useConversations(active = true) {
  const [data, setData] = useState<{ conversations: Conversation[]; online: boolean; unread: number } | null>(null);
  const load = useCallback(async () => {
    const r = await fetch("/api/support", { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }, []);
  useEffect(() => {
    if (active) void load();
  }, [load, active]);
  usePoll(load, 20000, active);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener("zenvio:support-read", refresh);
    return () => window.removeEventListener("zenvio:support-read", refresh);
  }, [load]);
  return { data, load };
}

/** Full-page help & support center at /app/support. */
export function SupportCenter() {
  const { data, load } = useConversations();
  const [active, setActive] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("conversation");
    if (id) setActive(id);
    if (new URLSearchParams(window.location.search).get("new")) setComposing(true);
  }, []);
  const open = (id: string | null) => {
    setActive(id);
    setComposing(false);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("conversation", id);
    else url.searchParams.delete("conversation");
    url.searchParams.delete("new");
    window.history.replaceState(null, "", url);
  };
  const list = data?.conversations || [];
  const showDetail = composing || !!active;
  return (
    <div className="ds-root sp-page">
      <PageHeader
        eyebrow="Help"
        title="Help & support"
        description="Chat with the Zenvio team, follow your conversations and share suggestions."
        actions={
          <button type="button" className="ds-btn primary" onClick={() => (setComposing(true), setActive(null))}>
            <Icon name="plus" size={15} /> New conversation
          </button>
        }
      />
      <Availability online={data ? data.online : null} />
      <div className={`sp-layout ${showDetail ? "show-detail" : ""}`}>
        <section className="sp-side" aria-label="Your conversations">
          {!data ? (
            <div className="sp-list-loading">
              <Skeleton height={56} />
              <Skeleton height={56} />
            </div>
          ) : list.length ? (
            <ConversationList items={list} active={active} onOpen={open} />
          ) : (
            <EmptyState icon="message" title="No conversations yet">
              Questions about your account, billing or an order? Start a conversation and the team will reply here.
            </EmptyState>
          )}
          <Link href="/app/feedback" className="sp-suggest">
            <span className="sp-suggest-icon">
              <Icon name="feedback" size={18} />
            </span>
            <span>
              <b>Have a suggestion?</b>
              <small>Ideas and bug reports go to the product team.</small>
            </span>
            <Icon name="chevron" size={14} />
          </Link>
        </section>
        <section className="sp-detail" aria-label="Conversation">
          {composing ? (
            <div className="sp-thread">
              <header className="sp-thread-head">
                <button type="button" className="sp-back" onClick={() => setComposing(false)} aria-label="Back to conversations">
                  <Icon name="chevron" size={14} />
                </button>
                <div>
                  <h2>New conversation</h2>
                  <p>Tell us what’s going on. You can keep chatting here once you send it.</p>
                </div>
              </header>
              <NewConversation
                onCreated={(id) => {
                  void load();
                  open(id);
                }}
              />
            </div>
          ) : active ? (
            <Thread key={active} id={active} onBack={() => open(null)} onChange={load} />
          ) : (
            <EmptyState icon="message" title="Pick a conversation">
              Or start a new one — we’re happy to help.
            </EmptyState>
          )}
        </section>
      </div>
    </div>
  );
}

/** Top-bar help button with an unread badge; opens a compact chat panel. */
export function SupportButton() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const { data, load } = useConversations(true);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      button.current?.focus();
    };
  }, [open]);
  useEffect(() => {
    const listen = () => setOpen(true);
    window.addEventListener("zenvio:support", listen);
    return () => window.removeEventListener("zenvio:support", listen);
  }, []);
  const unread = data?.unread || 0;
  const list = data?.conversations || [];
  return (
    <>
      <button
        ref={button}
        type="button"
        className="shell-icon-button sp-trigger"
        aria-label={unread ? `Help & support, ${unread} unread` : "Help & support"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="message" size={18} />
        {unread > 0 && <span className="sp-dot">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="ds-root sp-panel" role="dialog" aria-label="Help & support" ref={panel}>
          <header className="sp-panel-head">
            <b>
              <Icon name="message" size={16} /> Help & support
            </b>
            <span>
              <Link href={active ? `/app/support?conversation=${active}` : "/app/support"} className="sp-expand" onClick={() => setOpen(false)}>
                Open full view
              </Link>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)}>
                <Icon name="close" size={16} />
              </button>
            </span>
          </header>
          <div className="sp-panel-body">
            {composing ? (
              <div className="sp-thread">
                <header className="sp-thread-head">
                  <button type="button" className="sp-back" onClick={() => setComposing(false)} aria-label="Back">
                    <Icon name="chevron" size={14} />
                  </button>
                  <div>
                    <h2>New conversation</h2>
                  </div>
                </header>
                <NewConversation
                  compact
                  onCreated={(id) => {
                    setComposing(false);
                    setActive(id);
                    void load();
                  }}
                />
              </div>
            ) : active ? (
              <Thread key={active} id={active} onBack={() => (setActive(null), void load())} onChange={load} />
            ) : (
              <>
                <Availability online={data ? data.online : null} />
                <button type="button" className="ds-btn primary sp-start" onClick={() => setComposing(true)}>
                  <Icon name="plus" size={15} /> Start a conversation
                </button>
                {list.length > 0 && <ConversationList items={list.slice(0, 6)} onOpen={setActive} />}
                <div className="sp-panel-links">
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      window.dispatchEvent(new CustomEvent("zenvio:assistant", { detail: {} }));
                    }}
                  >
                    <Icon name="sparkles" size={15} /> Ask Zenvio Assistant
                  </button>
                  <Link href="/app/feedback" onClick={() => setOpen(false)}>
                    <Icon name="feedback" size={15} /> Share a suggestion
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
