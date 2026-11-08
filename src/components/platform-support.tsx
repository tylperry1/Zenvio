"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { supportCategories, supportCategoryLabel, supportPriorities } from "@/lib/support-options";
import { Badge, EmptyState, Kpi, Notice, PageHeader, Panel, SearchField, Segmented, Skeleton, formatDate, relativeTime, type Tone } from "./ds";
import { Icon } from "./icons";
import { Modal } from "./modal";

type Status = "open" | "pending" | "resolved";
type Ticket = {
  id: string;
  subject: string;
  status: Status;
  category: string;
  priority: string;
  rating: number | null;
  created_at: string;
  updated_at: string;
  assigned_to: string | null;
  assignee_name?: string | null;
  name: string;
  email?: string;
  visitor?: boolean;
  preview: string | null;
  unread: number;
};
export type Message = { id: string; sender_id: string | null; staff: boolean; internal: boolean; content: string; created_at: string; attachment: boolean };
type Reply = { id: string; title: string; content: string };
type Member = { id: string; name: string; online: boolean };
type Counts = {
  open: number;
  pending: number;
  unassigned: number;
  mine: number;
  visitors: number;
  latest_customer: string;
  first_response_minutes: number | null;
  rating: number | null;
  ratings: number;
};
type TicketMeta = Ticket & {
  visitor?: boolean;
  first_response_at: string | null;
  resolved_at: string | null;
  page?: string;
  customer_name?: string;
  customer_email?: string;
  customer_since?: string;
};
type Thread = {
  ticket: TicketMeta;
  messages: Message[];
  history?: { id: string; subject: string; status: Status; created_at: string }[];
  feedback?: { id: string; category: string; message: string; status: string; created_at: string }[];
};

const customerStatus: Record<Status, { label: string; tone: Tone }> = {
  open: { label: "Waiting on Zenvio", tone: "info" },
  pending: { label: "Zenvio replied", tone: "warning" },
  resolved: { label: "Resolved", tone: "success" },
};
const staffStatus: Record<Status, { label: string; tone: Tone }> = {
  open: { label: "Needs reply", tone: "danger" },
  pending: { label: "Waiting on customer", tone: "warning" },
  resolved: { label: "Resolved", tone: "success" },
};
const priorityTone: Record<string, Tone> = { urgent: "danger", high: "warning", normal: "neutral", low: "neutral" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const time = (s: string) => new Date(s).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const day = (s: string) => new Date(s).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const minutes = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n < 60 ? `${n} min` : n < 1440 ? `${Math.round(n / 6) / 10} h` : `${Math.round(n / 144) / 10} d`;

/** Runs `fn` on an interval while the tab is visible. */
function usePoll(fn: () => void, ms: number, active = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => document.visibilityState === "visible" && ref.current(), ms);
    const wake = () => document.visibilityState === "visible" && ref.current();
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [ms, active]);
}

export type LiveState = "connecting" | "live" | "offline";

/**
 * Subscribes to a support event stream and calls `onChange` when the server
 * reports new activity. The server closes each stream after ~25 s and the
 * browser reconnects; the last signature is kept so reconnects don't refetch.
 * After repeated failures it backs off and the caller's slower polling covers.
 */
export function useLive(url: string | null, onChange: () => void) {
  const [state, setState] = useState<LiveState>("connecting");
  const ref = useRef(onChange);
  ref.current = onChange;
  useEffect(() => {
    if (!url || typeof EventSource === "undefined") {
      setState("offline");
      return;
    }
    let source: EventSource | null = null,
      failures = 0,
      stopped = false,
      timer: number | undefined,
      last: string | null = null;
    const connect = () => {
      setState("connecting");
      source = new EventSource(url);
      source.addEventListener("open", () => {
        failures = 0;
        setState("live");
      });
      source.addEventListener("change", (e) => {
        const data = (e as MessageEvent).data;
        if (last !== null && data !== last) ref.current();
        last = data;
      });
      source.onerror = () => {
        failures++;
        if (failures > 3) {
          setState("offline");
          source?.close();
          timer = window.setTimeout(() => !stopped && connect(), 30000);
        } else if (source?.readyState === EventSource.CLOSED) {
          timer = window.setTimeout(() => !stopped && connect(), 2000);
        }
      };
    };
    connect();
    return () => {
      stopped = true;
      source?.close();
      window.clearTimeout(timer);
    };
  }, [url]);
  return state;
}

/** Live status pill and a manual refresh button. */
export function LiveControls({ state, onRefresh }: { state: LiveState; onRefresh: () => Promise<unknown> | void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const label = state === "live" ? "Live" : state === "connecting" ? "Connecting…" : "Auto-refresh";
  return (
    <span className="sp-live-controls">
      <span className={`sp-live ${state}`} role="status" title={state === "live" ? "New messages appear instantly" : state === "offline" ? "Live updates unavailable; refreshing every 30 seconds" : "Connecting to live updates"}>
        <i aria-hidden="true" />
        {label}
      </span>
      <button
        type="button"
        className={`ds-btn ghost sm sp-refresh ${busy ? "spinning" : ""}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onRefresh();
            setDone(true);
            window.setTimeout(() => setDone(false), 1500);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Icon name={done ? "check" : "refresh"} size={14} /> {done ? "Updated" : "Refresh"}
      </button>
    </span>
  );
}

/** A short two-tone chime, generated so no audio file is needed. */
export function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.12 + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.3);
    });
    window.setTimeout(() => void ctx.close(), 800);
  } catch {}
}

const pref = {
  get: (k: string, d: boolean) => {
    try {
      const v = localStorage.getItem(k);
      return v === null ? d : v === "1";
    } catch {
      return d;
    }
  },
  set: (k: string, v: boolean) => {
    try {
      localStorage.setItem(k, v ? "1" : "0");
    } catch {}
  },
};

async function send(endpoint: string, data: object) {
  const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || "That didn’t work. Please try again.");
  return d;
}

/** Loads every page of a conversation (the API pages messages 100 at a time). */
async function loadThread(endpoint: string, id: string): Promise<Thread> {
  let cursor = "0",
    hasMore = true,
    first: Partial<Thread> = {};
  const messages: Message[] = [];
  while (hasMore) {
    const r = await fetch(`${endpoint}?${new URLSearchParams({ ticket: id, after: cursor })}`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(d.error || "This conversation couldn’t be loaded.");
    if (cursor === "0") first = d;
    messages.push(...d.messages);
    cursor = messages.at(-1)?.id ?? cursor;
    hasMore = d.hasMore;
  }
  return { ...(first as Thread), messages };
}

export function MessageList({ messages, staff, endpoint, names }: { messages: Message[]; staff: boolean; endpoint: string; names?: Record<string, string> }) {
  const box = useRef<HTMLDivElement>(null);
  const count = messages.length;
  // Scroll the list only, never the page around it.
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [count]);
  let lastDay = "";
  return (
    <div className="sp-messages" role="log" aria-live="polite" aria-label="Conversation history" ref={box}>
      {!messages.length && <p className="sp-system">No messages yet.</p>}
      {messages.map((m) => {
        const d = day(m.created_at);
        const divider = d !== lastDay ? <p className="sp-day">{(lastDay = d)}</p> : null;
        const mine = staff ? m.staff : !m.staff;
        const author = m.staff ? (staff ? names?.[m.sender_id || ""] || "Zenvio team" : "Zenvio team") : staff ? "Customer" : "You";
        return (
          <div key={m.id}>
            {divider}
            <div className={`sp-msg ${mine ? "mine" : "theirs"} ${m.internal ? "internal" : ""}`}>
              <span className="sp-meta">
                {m.internal ? "Internal note · " : ""}
                {author} · {time(m.created_at)}
              </span>
              {m.attachment ? (
                <a className="sp-attachment" href={`${endpoint}/attachment?message=${m.id}`}>
                  <Icon name="image" size={15} /> {m.content}
                </a>
              ) : (
                <p>{m.content}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AttachButton({ endpoint, ticket, internal = false, onDone, onError }: { endpoint: string; ticket: string; internal?: boolean; onDone: () => void; onError: (m: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button type="button" className="ds-btn ghost sm" disabled={busy} onClick={() => input.current?.click()} aria-label="Attach an image">
        <Icon name="paperclip" size={14} /> {busy ? "Uploading…" : "Image"}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept="image/jpeg,image/png,image/webp"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (file.size > 2000000) return onError("Choose an image under 2 MB.");
          setBusy(true);
          try {
            const url = `${endpoint}/attachment?${new URLSearchParams({ ticket, filename: file.name, reference: crypto.randomUUID(), internal: String(internal) })}`;
            const r = await fetch(url, { method: "POST", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
            if (!r.ok) throw Error((await r.json().catch(() => ({}))).error || "The image couldn’t be uploaded.");
            onDone();
          } catch (err) {
            onError(err instanceof Error ? err.message : "The image couldn’t be uploaded.");
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

/** A composer whose idempotency reference is reused for retries of the same draft. */
export function useDraft() {
  const [text, setText] = useState("");
  const reference = useRef<string | null>(null);
  return {
    text,
    setText: (v: string | ((t: string) => string)) => {
      reference.current = null;
      setText(v);
    },
    reference: () => (reference.current ??= crypto.randomUUID()),
    clear: () => {
      reference.current = null;
      setText("");
    },
  };
}

// ------------------------------------------------------------------ customers

export function Availability({ online }: { online: boolean | null }) {
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
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const draft = useDraft();
  return (
    <form
      className="sp-new"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const d = await send("/api/support", { action: "create", subject, category, content: draft.text, page: window.location.pathname, reference: draft.reference() });
          draft.clear();
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
        <input required maxLength={150} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="A few words about what you need" />
      </label>
      <label className="ds-field">
        <span>How can we help?</span>
        <textarea required rows={compact ? 4 : 6} maxLength={4000} value={draft.text} onChange={(e) => draft.setText(e.target.value)} />
        <small>Don’t include passwords, full card numbers or clients’ sensitive information.</small>
      </label>
      <button className="ds-btn primary" disabled={busy}>
        <Icon name="send" size={15} /> {busy ? "Sending…" : "Start conversation"}
      </button>
    </form>
  );
}

function Rating({ ticket, onRated }: { ticket: TicketMeta; onRated: () => void }) {
  const [error, setError] = useState("");
  if (ticket.rating) return <p className="sp-rated">You rated this conversation {ticket.rating} out of 5. Thank you.</p>;
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
                await send("/api/support", { action: "rate", ticket: ticket.id, rating: n });
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

function CustomerThread({ id, version = 0, live = "offline", onBack, onChange }: { id: string; version?: number; live?: LiveState; onBack: () => void; onChange: () => void }) {
  const [data, setData] = useState<Thread | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const draft = useDraft();
  const load = useCallback(async () => {
    try {
      setData(await loadThread("/api/support", id));
      setError("");
      // Reading clears unread replies; let the top-bar badge catch up.
      window.dispatchEvent(new Event("zenvio:support-read"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "");
    }
  }, [id]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);
  useEffect(() => {
    if (version) void load();
  }, [version, load]);
  usePoll(load, live === "live" ? 30000 : 5000);
  async function submit() {
    if (!draft.text.trim() || busy || !data) return;
    setBusy(true);
    try {
      await send("/api/support", { action: "message", ticket: id, content: draft.text.trim(), reference: draft.reference() });
      draft.clear();
      await load();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "");
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <div className="sp-thread" aria-busy={!error}>
        {error ? <Notice tone="danger">{error}</Notice> : <><Skeleton height={20} width="50%" /><Skeleton height={60} /></>}
      </div>
    );
  const t = data.ticket;
  return (
    <div className="sp-thread">
      <header className="sp-thread-head">
        <button type="button" className="sp-back" onClick={onBack} aria-label="Back to conversations">
          <Icon name="chevron" size={14} />
        </button>
        <div>
          <h2>{t.subject}</h2>
          <p>
            {supportCategoryLabel(t.category)} · started {relativeTime(t.created_at)}
          </p>
        </div>
        <Badge tone={customerStatus[t.status].tone}>{customerStatus[t.status].label}</Badge>
      </header>
      {error && <Notice tone="danger">{error}</Notice>}
      <MessageList messages={data.messages} staff={false} endpoint="/api/support" />
      {t.status === "resolved" && <Rating ticket={t} onRated={load} />}
      <form
        className="sp-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          aria-label="Message"
          rows={2}
          maxLength={4000}
          value={draft.text}
          placeholder={t.status === "resolved" ? "Reply to reopen this conversation…" : "Write a message…"}
          onChange={(e) => draft.setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div className="sp-composer-row">
          <AttachButton endpoint="/api/support" ticket={id} onDone={load} onError={setError} />
          {t.status !== "resolved" && (
            <button
              type="button"
              className="ds-btn ghost sm"
              onClick={async () => {
                await send("/api/support", { action: "update", ticket: id, status: "resolved" }).catch((e) => setError(e.message));
                await load();
                onChange();
              }}
            >
              <Icon name="check" size={14} /> Mark resolved
            </button>
          )}
          <button type="submit" className="ds-btn primary sm" disabled={busy || !draft.text.trim()}>
            <Icon name="send" size={14} /> {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ConversationList({ items, active, onOpen }: { items: Ticket[]; active?: string | null; onOpen: (id: string) => void }) {
  return (
    <ul className="sp-list">
      {items.map((t) => (
        <li key={t.id}>
          <button type="button" className={active === t.id ? "active" : ""} onClick={() => onOpen(t.id)}>
            <span className="sp-list-top">
              <b>{t.subject}</b>
              <small>{relativeTime(t.updated_at)}</small>
            </span>
            {t.preview && <span className="sp-list-preview">{t.preview}</span>}
            <span className="sp-list-tags">
              <Badge tone={customerStatus[t.status].tone}>{customerStatus[t.status].label}</Badge>
              {t.unread > 0 && <span className="sp-unread">{t.unread} new</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function useCustomerTickets(active = true, interval = 20000) {
  const [data, setData] = useState<{ tickets: Ticket[]; online: boolean } | null>(null);
  const load = useCallback(async () => {
    const r = await fetch("/api/support", { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }, []);
  useEffect(() => {
    if (active) void load();
  }, [load, active]);
  usePoll(load, interval, active);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener("zenvio:support-read", refresh);
    return () => window.removeEventListener("zenvio:support-read", refresh);
  }, [load]);
  return { data, load, unread: data?.tickets.reduce((n, t) => n + t.unread, 0) || 0 };
}

function CustomerSupport() {
  const [version, setVersion] = useState(0);
  const [liveOk, setLiveOk] = useState(true);
  const { data, load } = useCustomerTickets(true, liveOk ? 60000 : 20000);
  const live = useLive("/api/support/stream", () => {
    void load();
    setVersion((v) => v + 1);
  });
  useEffect(() => setLiveOk(live === "live"), [live]);
  const refresh = async () => {
    await load();
    setVersion((v) => v + 1);
  };
  const [active, setActive] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("ticket")) setActive(params.get("ticket"));
    else if (params.get("new")) setComposing(true);
  }, []);
  const open = (id: string | null) => {
    setActive(id);
    setComposing(false);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("ticket", id);
    else url.searchParams.delete("ticket");
    url.searchParams.delete("new");
    window.history.replaceState(null, "", url);
  };
  const list = data?.tickets || [];
  return (
    <div className="ds-root sp-page">
      <PageHeader
        eyebrow="Help"
        title="Zenvio support"
        description="Chat with the Zenvio team, follow your conversations and share suggestions."
        actions={
          <>
            <LiveControls state={live} onRefresh={refresh} />
            <Link href="/help" className="ds-btn">
              <Icon name="search" size={15} /> Help Center
            </Link>
            <button type="button" className="ds-btn primary" onClick={() => (setComposing(true), setActive(null))}>
              <Icon name="plus" size={15} /> New conversation
            </button>
          </>
        }
      />
      <Availability online={data ? data.online : null} />
      <div className={`sp-layout ${composing || active ? "show-detail" : ""}`}>
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
            <CustomerThread key={active} id={active} version={version} live={live} onBack={() => open(null)} onChange={load} />
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
export function SupportLauncher() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [version, setVersion] = useState(0);
  const { data, load, unread } = useCustomerTickets(true, open ? 30000 : 60000);
  const live = useLive(open ? "/api/support/stream" : null, () => {
    void load();
    setVersion((v) => v + 1);
  });
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector("dialog[open]") && setOpen(false);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      button.current?.focus();
    };
  }, [open]);
  const list = data?.tickets || [];
  return (
    <>
      <button
        ref={button}
        type="button"
        className="shell-icon-button sp-trigger"
        aria-label={unread ? `Help & support, ${unread} unread` : "Help & support"}
        aria-expanded={open}
        aria-controls="zenvio-support"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="message" size={18} />
        {unread > 0 && <span className="sp-dot">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div id="zenvio-support" className="ds-root sp-panel" role="dialog" aria-label="Zenvio support">
          <header className="sp-panel-head">
            <b>
              <Icon name="message" size={16} /> Help & support
            </b>
            <span>
              <button
                type="button"
                className="sp-icon-btn"
                aria-label="Refresh"
                title={live === "live" ? "Live — refresh now" : "Refresh"}
                onClick={() => {
                  void load();
                  setVersion((v) => v + 1);
                }}
              >
                <Icon name="refresh" size={15} />
                {live === "live" && <i className="sp-live-dot" aria-hidden="true" />}
              </button>
              <Link href={active ? `/app/support?ticket=${active}` : "/app/support"} className="sp-expand" onClick={() => setOpen(false)}>
                Open full page
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
              <CustomerThread key={active} id={active} version={version} live={live} onBack={() => (setActive(null), void load())} onChange={load} />
            ) : (
              <>
                <Availability online={data ? data.online : null} />
                <button type="button" className="ds-btn primary sp-start" onClick={() => setComposing(true)}>
                  <Icon name="plus" size={15} /> Start a conversation
                </button>
                {list.length > 0 && <ConversationList items={list.slice(0, 6)} onOpen={setActive} />}
                <div className="sp-panel-links">
                  <Link href="/help" onClick={() => setOpen(false)}>
                    <Icon name="search" size={15} /> Search the Help Center
                  </Link>
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

// ------------------------------------------------------------------ employees

type Queue = { tickets: Ticket[]; hasMore: boolean; replies: Reply[]; counts: Counts; team: Member[]; available: boolean; emailAlerts: boolean; me: string };

function SupportConsole() {
  const [view, setView] = useState<"" | "mine" | "unassigned" | "visitors">("");
  const [status, setStatus] = useState<"active" | Status | "">("active");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Queue | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const latest = useRef<string | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = active;
  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/support?${new URLSearchParams({ view, status, q, category, page: String(page) })}`, { cache: "no-store" });
    const d: Queue & { error?: string } = await r.json().catch(() => ({}));
    if (!r.ok) return setError(d.error || "The support inbox couldn’t be loaded.");
    setError("");
    setData(d);
    // Alert on new customer or visitor messages that arrived since the last load.
    const newest = d.counts.latest_customer;
    if (latest.current !== null && BigInt(newest) > BigInt(latest.current)) {
      const ticket = [...d.tickets].filter((t) => t.unread > 0).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
      const watching = ticket && ticket.id === activeRef.current && document.visibilityState === "visible";
      if (!watching) {
        if (pref.get("zv-support-sound", true)) chime();
        if (pref.get("zv-support-desktop", true) && typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
          const n = new Notification(ticket ? `${ticket.name || ticket.email || "Customer"}${ticket.visitor ? " (website)" : ""}` : "New support message", {
            body: ticket ? `${ticket.subject}${ticket.preview ? ` — ${ticket.preview.slice(0, 120)}` : ""}` : "Open the support inbox to reply.",
            tag: ticket ? `support-${ticket.id}` : "support",
          });
          n.onclick = () => {
            window.focus();
            if (ticket) select(ticket.id);
            n.close();
          };
        }
      }
    }
    latest.current = newest;
  }, [view, status, q, category, page]);
  const live = useLive("/api/admin/support/stream", () => {
    void load();
    setVersion((v) => v + 1);
  });
  // Show the number of conversations needing a reply in the browser tab.
  useEffect(() => {
    const base = "Support inbox | Zenvio";
    document.title = data?.counts.open ? `(${data.counts.open}) ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [data?.counts.open]);
  useEffect(() => {
    const t = window.setTimeout(() => void load(), q ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [load, q]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("ticket");
    if (id) setActive(id);
  }, []);
  usePoll(load, live === "live" ? 60000 : 15000);
  const select = (id: string | null) => {
    setActive(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("ticket", id);
    else url.searchParams.delete("ticket");
    window.history.replaceState(null, "", url);
  };
  const filter = <T,>(set: (v: T) => void) => (v: T) => (set(v), setPage(0));
  const c = data?.counts;
  return (
    <div className={`ds-root sp-admin ${active ? "has-active" : ""}`}>
      <PageHeader
        eyebrow="Customer service"
        title="Support inbox"
        description="Live chat from customers. Reply, assign, set priority, add private notes and file suggestions for the product team."
        actions={
          <>
            <LiveControls
              state={live}
              onRefresh={async () => {
                await load();
                setVersion((v) => v + 1);
              }}
            />
            {data && (
              <button
                type="button"
                className={`sp-presence ${data.available ? "on" : ""}`}
                aria-pressed={data.available}
                onClick={async () => {
                  await send("/api/admin/support", { action: "availability", available: !data.available }).catch((e) => setError(e.message));
                  void load();
                }}
              >
                <i aria-hidden="true" /> {data.available ? "Available for chat" : "Away"}
              </button>
            )}
            <button type="button" className="ds-btn" onClick={() => setAlertsOpen(true)}>
              <Icon name="bell" size={14} /> Alerts
            </button>
            <button type="button" className="ds-btn" onClick={() => setRepliesOpen(true)}>
              <Icon name="edit" size={14} /> Saved replies
            </button>
          </>
        }
      />
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="ds-kpis sp-kpis">
        <Kpi label="Needs reply" value={c?.open ?? 0} loading={!data} tone={c?.open ? "danger" : undefined} />
        <Kpi label="Unassigned" value={c?.unassigned ?? 0} loading={!data} />
        <Kpi label="Waiting on customer" value={c?.pending ?? 0} loading={!data} />
        <Kpi label="First response (30 days)" value={minutes(c?.first_response_minutes)} loading={!data} detail="Average time to first reply" />
        <Kpi label="Satisfaction (30 days)" value={c?.rating ? `${c.rating} / 5` : "—"} loading={!data} detail={c?.ratings ? `${c.ratings} rating${c.ratings === 1 ? "" : "s"}` : "No ratings yet"} />
      </div>
      <div className={`sp-console ${active ? "show-detail" : ""}`}>
        <section className="sp-queue" aria-label="Conversations">
          <div className="sp-filters">
            <Segmented
              label="Assignment"
              value={view}
              onChange={filter(setView)}
              options={[
                ["", "All"],
                ["mine", `Mine${c?.mine ? ` (${c.mine})` : ""}`],
                ["unassigned", "Unassigned"],
                ["visitors", `Website${c?.visitors ? ` (${c.visitors})` : ""}`],
              ]}
            />
            <div className="sp-filter-row">
              <select aria-label="Status" value={status} onChange={(e) => filter(setStatus)(e.target.value as typeof status)}>
                <option value="active">Active</option>
                <option value="open">Needs reply</option>
                <option value="pending">Waiting on customer</option>
                <option value="resolved">Resolved</option>
                <option value="">All statuses</option>
              </select>
              <select aria-label="Topic" value={category} onChange={(e) => filter(setCategory)(e.target.value)}>
                <option value="">All topics</option>
                {supportCategories.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <SearchField value={q} onChange={filter(setQ)} placeholder="Search subject, name or email" label="Search conversations" />
          </div>
          {!data ? (
            <div className="sp-list-loading">
              <Skeleton height={64} />
              <Skeleton height={64} />
            </div>
          ) : data.tickets.length ? (
            <ul className="sp-list">
              {data.tickets.map((t) => (
                <li key={t.id}>
                  <button type="button" className={active === t.id ? "active" : ""} onClick={() => select(t.id)}>
                    <span className="sp-list-top">
                      <b>{t.name || t.email}</b>
                      <small>{relativeTime(t.updated_at)}</small>
                    </span>
                    <span className="sp-list-subject">{t.subject}</span>
                    {t.preview && <span className="sp-list-preview">{t.preview}</span>}
                    <span className="sp-list-tags">
                      <Badge tone={staffStatus[t.status].tone}>{staffStatus[t.status].label}</Badge>
                      {t.visitor && <Badge tone="info">Website visitor</Badge>}
                      {t.priority !== "normal" && <Badge tone={priorityTone[t.priority]}>{cap(t.priority)}</Badge>}
                      <small>{t.assignee_name ? t.assignee_name.split(" ")[0] : "Unassigned"}</small>
                      {t.unread > 0 && <span className="sp-unread">{t.unread} new</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="message" title={status === "active" ? "Inbox zero" : "Nothing here"}>
              {status === "active" ? "No customer is waiting. New chats appear here automatically." : "Nothing matches these filters."}
            </EmptyState>
          )}
          {data && (page > 0 || data.hasMore) && (
            <div className="sp-pager">
              <button type="button" className="ds-btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <button type="button" className="ds-btn sm" disabled={!data.hasMore} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </div>
          )}
        </section>
        <section className="sp-workspace" aria-label="Conversation">
          {active && data ? (
            <StaffThread key={active} id={active} version={version} live={live} team={data.team} replies={data.replies} me={data.me} onBack={() => select(null)} onChange={load} />
          ) : (
            <EmptyState icon="message" title="Select a conversation">
              Pick a conversation from the queue to read and reply.
            </EmptyState>
          )}
        </section>
      </div>
      {repliesOpen && data && <SavedReplies replies={data.replies} onClose={() => setRepliesOpen(false)} onChange={load} />}
      {alertsOpen && data && <AlertSettings emailAlerts={data.emailAlerts} onClose={() => setAlertsOpen(false)} onChange={load} />}
    </div>
  );
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}

function StaffThread({
  id,
  version = 0,
  live = "offline",
  team,
  replies,
  me,
  onBack,
  onChange,
}: {
  id: string;
  version?: number;
  live?: LiveState;
  team: Member[];
  replies: Reply[];
  me: string;
  onBack: () => void;
  onChange: () => void;
}) {
  const [d, setD] = useState<Thread | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [internal, setInternal] = useState(false);
  const [after, setAfter] = useState<"pending" | "resolved" | "">("pending");
  const [busy, setBusy] = useState(false);
  const draft = useDraft();
  const names = Object.fromEntries(team.map((m) => [m.id, m.name]));
  const load = useCallback(async () => {
    try {
      setD(await loadThread("/api/admin/support", id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "");
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (version) void load();
  }, [version, load]);
  usePoll(load, live === "live" ? 30000 : 5000);
  async function update(patch: Record<string, unknown>) {
    try {
      await send("/api/admin/support", { action: "update", ticket: id, ...patch });
      await load();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "");
    }
  }
  async function submit() {
    if (!draft.text.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await send("/api/admin/support", { action: "message", ticket: id, content: draft.text.trim(), internal, reference: draft.reference(), ...(!internal && after && { status: after }) });
      draft.clear();
      await load();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "");
    } finally {
      setBusy(false);
    }
  }
  if (!d)
    return error ? (
      <Notice tone="danger">{error}</Notice>
    ) : (
      <div className="sp-thread" aria-busy="true">
        <Skeleton height={22} width="60%" />
        <Skeleton height={120} />
      </div>
    );
  const t = d.ticket;
  const lastCustomer = [...d.messages].reverse().find((m) => !m.staff && !m.attachment);
  return (
    <div className="sp-work">
      <div className="sp-thread">
        <header className="sp-thread-head">
          <button type="button" className="sp-back" onClick={onBack} aria-label="Back to queue">
            <Icon name="chevron" size={14} />
          </button>
          <div>
            <h2>{t.subject}</h2>
            <p>
              {supportCategoryLabel(t.category)} · opened {relativeTime(t.created_at)}
              {t.page ? ` · from ${t.page}` : ""}
            </p>
          </div>
          <Badge tone={staffStatus[t.status].tone}>{staffStatus[t.status].label}</Badge>
        </header>
        {t.visitor && <Notice tone="info">Website visitor without an account. Replies are emailed to {t.customer_email} with a private link back to this chat. Images can’t be sent to visitors.</Notice>}
        <div className="sp-controls">
          <Select label="Assignee" value={t.assigned_to || ""} onChange={(v) => update({ assigned: v || null })}>
            <option value="">Unassigned</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === me ? `${m.name} (you)` : m.name}
                {m.online ? " · online" : ""}
              </option>
            ))}
          </Select>
          <Select label="Priority" value={t.priority} onChange={(v) => update({ priority: v })}>
            {supportPriorities.map((p) => (
              <option key={p} value={p}>
                {cap(p)}
              </option>
            ))}
          </Select>
          <Select label="Status" value={t.status} onChange={(v) => update({ status: v })}>
            <option value="open">Needs reply</option>
            <option value="pending">Waiting on customer</option>
            <option value="resolved">Resolved</option>
          </Select>
          {t.assigned_to !== me && (
            <button type="button" className="ds-btn sm" onClick={() => update({ assigned: "self" })}>
              Assign to me
            </button>
          )}
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        {notice && <Notice tone="success">{notice}</Notice>}
        <MessageList messages={d.messages} staff endpoint="/api/admin/support" names={names} />
        {lastCustomer && (
          <div className="sp-msg-actions">
            <button
              type="button"
              className="ds-btn ghost sm"
              onClick={async () => {
                try {
                  await send("/api/admin/support", { action: "suggestion", message: lastCustomer.id });
                  setNotice("Filed in Suggestions & feedback.");
                  await load();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "");
                }
              }}
            >
              <Icon name="feedback" size={14} /> File latest customer message as a suggestion
            </button>
          </div>
        )}
        <form
          className={`sp-composer ${internal ? "internal" : ""}`}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="sp-composer-tabs" role="group" aria-label="Message type">
            <button type="button" aria-pressed={!internal} onClick={() => setInternal(false)}>
              Reply to customer
            </button>
            <button type="button" aria-pressed={internal} onClick={() => setInternal(true)}>
              Internal note
            </button>
          </div>
          <textarea
            aria-label={internal ? "Internal note" : "Reply"}
            rows={3}
            maxLength={4000}
            value={draft.text}
            placeholder={internal ? "Only Zenvio employees can see notes." : `Reply to ${t.customer_name?.split(" ")[0] || "the customer"}…`}
            onChange={(e) => draft.setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <div className="sp-composer-row">
            {!t.visitor && <AttachButton endpoint="/api/admin/support" ticket={id} internal={internal} onDone={load} onError={setError} />}
            {replies.length > 0 && (
              <select
                aria-label="Insert saved reply"
                value=""
                onChange={(e) => {
                  const r = replies.find((x) => x.id === e.target.value);
                  if (r) draft.setText((v) => (v ? `${v}\n\n${r.content}` : r.content));
                }}
              >
                <option value="">Insert saved reply…</option>
                {replies.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            )}
            {!internal && (
              <select aria-label="Status after sending" value={after} onChange={(e) => setAfter(e.target.value as typeof after)}>
                <option value="pending">Then: wait on customer</option>
                <option value="resolved">Then: resolve</option>
                <option value="">Then: keep open</option>
              </select>
            )}
            <button type="submit" className="ds-btn primary sm" disabled={busy || !draft.text.trim()}>
              <Icon name="send" size={14} /> {busy ? "Sending…" : internal ? "Save private note" : "Send reply"}
            </button>
          </div>
          {!internal && <small className="sp-hint">The customer also gets an email with a link back to this conversation. ⌘/Ctrl + Enter sends.</small>}
        </form>
      </div>
      <aside className="sp-customer" aria-label="Customer">
        <Panel title="Customer">
          <dl className="sp-facts">
            <dt>Name</dt>
            <dd>{t.customer_name || "—"}</dd>
            <dt>Email</dt>
            <dd>{t.customer_email ? <a href={`mailto:${t.customer_email}`}>{t.customer_email}</a> : "—"}</dd>
            <dt>Type</dt>
            <dd>{t.visitor ? "Website visitor" : "Zenvio account"}</dd>
            {t.customer_since && (
              <>
                <dt>Customer since</dt>
                <dd>{formatDate(t.customer_since)}</dd>
              </>
            )}
            {t.first_response_at && (
              <>
                <dt>First reply</dt>
                <dd>{minutes(Math.round((new Date(t.first_response_at).getTime() - new Date(t.created_at).getTime()) / 60000))}</dd>
              </>
            )}
            {t.rating && (
              <>
                <dt>Rating</dt>
                <dd>{t.rating} / 5</dd>
              </>
            )}
          </dl>
          {!t.visitor && (
            <Link className="sp-link" href="/admin?view=accounts">
              Customer accounts <Icon name="external" size={12} />
            </Link>
          )}
        </Panel>
        <Panel title="Earlier conversations">
          {d.history?.length ? (
            <ul className="sp-mini">
              {d.history.map((h) => (
                <li key={h.id}>
                  <Link href={`/admin/support?ticket=${h.id}`}>{h.subject}</Link>
                  <small>
                    {staffStatus[h.status]?.label} · {formatDate(h.created_at)}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sp-muted">None.</p>
          )}
        </Panel>
        <Panel title="Suggestions & feedback">
          {d.feedback?.length ? (
            <ul className="sp-mini">
              {d.feedback.map((s) => (
                <li key={s.id}>
                  <span>{s.message.length > 90 ? `${s.message.slice(0, 90)}…` : s.message}</span>
                  <small>
                    {cap(s.category)} · {s.status} · {formatDate(s.created_at)}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sp-muted">None.</p>
          )}
          <Link className="sp-link" href="/admin/feedback">
            Suggestions inbox <Icon name="chevron" size={12} />
          </Link>
        </Panel>
      </aside>
    </div>
  );
}

function AlertSettings({ emailAlerts, onClose, onChange }: { emailAlerts: boolean; onClose: () => void; onChange: () => void }) {
  const [permission, setPermission] = useState<string>(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const [desktop, setDesktop] = useState(() => pref.get("zv-support-desktop", true));
  const [sound, setSound] = useState(() => pref.get("zv-support-sound", true));
  const [email, setEmail] = useState(emailAlerts);
  const [error, setError] = useState("");
  return (
    <Modal title="Support alerts" onClose={onClose}>
      <div className="ds-root sp-alerts">
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="sp-alert-row">
          <div>
            <b>Desktop notifications</b>
            <small>Pop-up alerts for new messages while this inbox is open in another tab or window.</small>
          </div>
          {permission === "granted" ? (
            <label className="sp-switch">
              <input
                type="checkbox"
                checked={desktop}
                onChange={(e) => {
                  setDesktop(e.target.checked);
                  pref.set("zv-support-desktop", e.target.checked);
                }}
              />
              <span>{desktop ? "On" : "Off"}</span>
            </label>
          ) : permission === "denied" ? (
            <small className="sp-muted">Blocked in your browser settings</small>
          ) : permission === "unsupported" ? (
            <small className="sp-muted">Not supported in this browser</small>
          ) : (
            <button type="button" className="ds-btn primary sm" onClick={async () => setPermission(await Notification.requestPermission())}>
              Turn on
            </button>
          )}
        </div>
        <div className="sp-alert-row">
          <div>
            <b>Sound</b>
            <small>A short chime when a customer or visitor writes.</small>
          </div>
          <span className="sp-row-actions">
            <button type="button" className="ds-btn ghost sm" onClick={() => chime()}>
              Test
            </button>
            <label className="sp-switch">
              <input
                type="checkbox"
                checked={sound}
                onChange={(e) => {
                  setSound(e.target.checked);
                  pref.set("zv-support-sound", e.target.checked);
                }}
              />
              <span>{sound ? "On" : "Off"}</span>
            </label>
          </span>
        </div>
        <div className="sp-alert-row">
          <div>
            <b>Email when I’m away</b>
            <small>New chats (and replies to conversations assigned to you) are emailed when you haven’t had the inbox open for 3 minutes.</small>
          </div>
          <label className="sp-switch">
            <input
              type="checkbox"
              checked={email}
              onChange={async (e) => {
                const enabled = e.target.checked;
                setEmail(enabled);
                try {
                  await send("/api/admin/support", { action: "email-alerts", enabled });
                  onChange();
                } catch (err) {
                  setEmail(!enabled);
                  setError(err instanceof Error ? err.message : "");
                }
              }}
            />
            <span>{email ? "On" : "Off"}</span>
          </label>
        </div>
      </div>
    </Modal>
  );
}

function SavedReplies({ replies, onClose, onChange }: { replies: Reply[]; onClose: () => void; onChange: () => void }) {
  const [editing, setEditing] = useState<{ title: string; content: string } | null>(null);
  const [error, setError] = useState("");
  return (
    <Modal title="Saved replies" onClose={onClose}>
      <div className="ds-root sp-replies">
        {error && <Notice tone="danger">{error}</Notice>}
        {editing ? (
          <form
            className="sp-new"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await send("/api/admin/support", { action: "save-reply", ...editing });
                setEditing(null);
                onChange();
              } catch (err) {
                setError(err instanceof Error ? err.message : "");
              }
            }}
          >
            <label className="ds-field">
              <span>Title</span>
              <input required maxLength={100} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            </label>
            <label className="ds-field">
              <span>Reply</span>
              <textarea required rows={6} maxLength={4000} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
            </label>
            <div className="sp-composer-row">
              <button type="button" className="ds-btn ghost sm" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="ds-btn primary sm">Save reply</button>
            </div>
          </form>
        ) : (
          <>
            {replies.length ? (
              <ul className="sp-mini">
                {replies.map((r) => (
                  <li key={r.id}>
                    <b>{r.title}</b>
                    <small>{r.content.length > 120 ? `${r.content.slice(0, 120)}…` : r.content}</small>
                    <span className="sp-row-actions">
                      <button
                        type="button"
                        className="ds-btn ghost sm danger"
                        onClick={async () => {
                          if (!window.confirm(`Delete “${r.title}”?`)) return;
                          await send("/api/admin/support", { action: "delete-reply", id: r.id }).catch((e) => setError(e.message));
                          onChange();
                        }}
                      >
                        Delete
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sp-muted">No saved replies yet. Save answers the team sends often.</p>
            )}
            <button type="button" className="ds-btn primary sm" onClick={() => setEditing({ title: "", content: "" })}>
              <Icon name="plus" size={14} /> New saved reply
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Customer support page, or the employee support inbox with `staff`. */
export function PlatformSupport({ staff = false }: { staff?: boolean; compact?: boolean }) {
  return staff ? <SupportConsole /> : <CustomerSupport />;
}
