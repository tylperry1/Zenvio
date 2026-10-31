"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { Alert, Badge, EmptyState, Meter, Skeleton, formatDateTime, useConfirm, useToast } from "./ui";

export type AssistantContextRef = { type: "client" | "appointment" | "job" | "document"; id: string; label?: string };
type Preview = {
  title: string;
  summary: string;
  details: { label: string; value: string }[];
  confirmLabel: string;
  danger?: boolean;
  warning?: string;
};
type Action = {
  id: string;
  tool: string;
  status: "pending" | "approved" | "rejected" | "succeeded" | "failed" | "expired";
  preview: Preview;
  result?: { message?: string } | null;
  error?: string | null;
};
type ToolChip = { name: string; label?: string; status: string; detail?: string; action?: string };
type Item = {
  key: string;
  role: "user" | "assistant" | "outcome";
  text: string;
  tools: ToolChip[];
  actions: string[];
  error?: { message: string; retryable: boolean };
  streaming?: boolean;
};
type Status = {
  configured: boolean;
  limits: { enabled: boolean; dailyRequests: number; monthlyTokens: number };
  used: { today: number; monthTokens: number };
  conversations: { id: string; title: string; updated_at: string }[];
};

const toolLabels: Record<string, string> = {
  list_appointments: "Checked appointments",
  find_free_time: "Checked availability",
  search_clients: "Searched clients",
  get_client: "Opened client record",
  find_inactive_clients: "Found inactive clients",
  list_documents: "Checked documents",
  business_summary: "Summarized the business",
  list_booking_links: "Checked booking links",
  list_conversations: "Checked the inbox",
  list_jobs: "Checked jobs",
};

const generalPrompts = [
  "What appointments do I have tomorrow?",
  "Find a free hour next Tuesday.",
  "Send my booking link to Sarah.",
  "Which customers haven’t booked recently?",
  "Show documents waiting for signatures.",
  "Draft a follow-up message for yesterday’s appointments.",
];
function promptsFor(context?: AssistantContextRef) {
  if (context?.type === "client")
    return ["Summarize this client.", "Send this client my booking link.", "Draft a follow-up message for this client.", "Add a follow-up task for next week."];
  if (context?.type === "appointment")
    return ["Draft a reminder for this appointment.", "Find another time on the same day.", "Summarize this guest’s history."];
  if (context?.type === "job")
    return ["Summarize this job.", "Draft an update for the customer.", "What’s left to do on this job?"];
  if (context?.type === "document")
    return ["Who still needs to sign this?", "Draft a polite signing reminder."];
  return generalPrompts;
}

// Opens the assistant panel from anywhere in the workspace.
export function openAssistant(detail: { prompt?: string; context?: AssistantContextRef } = {}) {
  window.dispatchEvent(new CustomEvent("zenvio:assistant", { detail }));
}

export function AskZenvio({
  context,
  prompt,
  label = "Ask Zenvio",
  className = "ui-btn ui-btn-secondary",
}: {
  context?: AssistantContextRef;
  prompt?: string;
  label?: string;
  className?: string;
}) {
  return (
    <button type="button" className={className} onClick={() => openAssistant({ context, prompt })}>
      <Icon name="sparkles" size={15} /> {label}
    </button>
  );
}

// Minimal, safe formatting: paragraphs, "- " lists and **bold**. No HTML is interpreted.
function Rich({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? <b key={i}>{part.slice(2, -2)}</b> : <Fragment key={i}>{part}</Fragment>,
    );
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l)))
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ""))}</li>
              ))}
            </ul>
          );
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l.replace(/^#+\s*/, ""))}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}

function ActionCard({ action, onDecide, busy }: { action: Action; onDecide: (a: Action, approve: boolean) => void; busy: boolean }) {
  const p = action.preview;
  const tone =
    action.status === "succeeded" ? "success" : action.status === "failed" ? "danger" : action.status === "pending" ? "info" : "neutral";
  const label = {
    pending: "Needs your approval",
    approved: "Running…",
    succeeded: "Done",
    failed: "Failed",
    rejected: "Declined",
    expired: "Expired",
  }[action.status];
  return (
    <div className={`as-action as-action-${action.status}`} aria-live="polite">
      <div className="as-action-head">
        <b>{p.title}</b>
        <Badge tone={tone}>{label}</Badge>
      </div>
      <div className="as-action-summary">{p.summary}</div>
      {p.details.length > 0 && (
        <dl className="as-action-details">
          {p.details.map((d) => (
            <div key={d.label}>
              <dt>{d.label}</dt>
              <dd>{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {p.warning && <p className="as-action-warning">{p.warning}</p>}
      {action.status === "succeeded" && action.result?.message && <p className="as-action-result">{action.result.message}</p>}
      {action.status === "failed" && <p className="as-action-error">{action.error || "The action couldn’t be completed."}</p>}
      {action.status === "expired" && <p className="as-action-muted">This approval expired. Ask again to prepare a fresh one.</p>}
      {action.status === "pending" && (
        <div className="as-action-buttons">
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy} onClick={() => onDecide(action, false)}>
            Decline
          </button>
          <button
            type="button"
            className={`ui-btn ui-btn-sm ${p.danger ? "ui-btn-danger" : "ui-btn-primary"}`}
            disabled={busy}
            onClick={() => onDecide(action, true)}
          >
            {p.confirmLabel}
          </button>
        </div>
      )}
    </div>
  );
}

export function AssistantChat({
  conversationId,
  onConversation,
  context,
  initialPrompt,
  status,
  onStatusChange,
}: {
  conversationId: string | null;
  onConversation: (id: string | null) => void;
  context?: AssistantContextRef;
  initialPrompt?: string;
  status: Status | null;
  onStatusChange?: () => void;
}) {
  const [items, setItems] = useState<Item[]>([]),
    [actions, setActions] = useState<Record<string, Action>>({}),
    [input, setInput] = useState(""),
    [sending, setSending] = useState(false),
    [loading, setLoading] = useState(false),
    [deciding, setDeciding] = useState("");
  const { confirm, node: confirmNode } = useConfirm();
  const toast = useToast();
  const scroller = useRef<HTMLDivElement>(null);
  const activeConversation = useRef<string | null>(conversationId);
  const lastPrompt = useRef("");
  const sentInitial = useRef("");

  useEffect(() => {
    // A conversation started in this view is already on screen; only fetch history for others.
    if (conversationId && conversationId === activeConversation.current && items.length) return;
    activeConversation.current = conversationId;
    if (!conversationId) {
      setItems([]);
      setActions({});
      return;
    }
    let alive = true;
    setLoading(true);
    fetch(`/api/assistant?conversation=${conversationId}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (!alive) return;
        const map: Record<string, Action> = {};
        for (const a of d.actions) map[a.id] = a;
        setActions(map);
        setItems(
          d.messages.map((m: { id: string; role: string; content: string; tools: ToolChip[] }) =>
            m.role === "assistant" && m.content.startsWith("[Action outcome]")
              ? { key: m.id, role: "outcome", text: m.content.replace("[Action outcome] ", ""), tools: [], actions: [] }
              : {
                  key: m.id,
                  role: m.role,
                  text: m.content === "(Prepared actions for review.)" ? "" : m.content,
                  tools: (m.tools || []).filter((t) => !t.action),
                  actions: (m.tools || []).filter((t) => t.action).map((t) => t.action as string),
                },
          ),
        );
      })
      .catch((e) => alive && toast.show(e.message, true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [items]);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || sending) return;
      lastPrompt.current = message;
      setInput("");
      setSending(true);
      const key = Math.random().toString(36).slice(2);
      setItems((prev) => [
        ...prev,
        { key: key + "u", role: "user", text: message, tools: [], actions: [] },
        { key: key + "a", role: "assistant", text: "", tools: [], actions: [], streaming: true },
      ]);
      const patch = (fn: (item: Item) => Item) =>
        setItems((prev) => prev.map((i) => (i.key === key + "a" ? fn(i) : i)));
      try {
        const r = await fetch("/api/assistant/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, conversationId: activeConversation.current, context }),
        });
        if (!r.ok || !r.body) {
          const d = await r.json().catch(() => ({}));
          throw Object.assign(Error(d.error || "The assistant is unavailable right now."), { retryable: r.status >= 500 || r.status === 429 });
        }
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const part of parts) {
            if (!part.startsWith("data: ")) continue;
            const event = JSON.parse(part.slice(6));
            if (event.type === "conversation" && event.id !== activeConversation.current) {
              activeConversation.current = event.id;
              onConversation(event.id);
            } else if (event.type === "text") patch((i) => ({ ...i, text: i.text + event.text }));
            else if (event.type === "tool")
              patch((i) => ({ ...i, tools: [...i.tools, { name: event.name, label: event.label, status: event.status, detail: event.detail }] }));
            else if (event.type === "action") {
              setActions((prev) => ({ ...prev, [event.action.id]: event.action }));
              patch((i) => ({ ...i, actions: [...i.actions, event.action.id] }));
            } else if (event.type === "error") patch((i) => ({ ...i, error: { message: event.message, retryable: event.retryable } }));
          }
        }
      } catch (e) {
        patch((i) => ({
          ...i,
          error: {
            message: e instanceof Error ? e.message : "The assistant is unavailable right now.",
            retryable: (e as { retryable?: boolean }).retryable ?? true,
          },
        }));
      } finally {
        patch((i) => ({ ...i, streaming: false }));
        setSending(false);
        onStatusChange?.();
      }
    },
    [sending, context, onConversation, onStatusChange],
  );

  useEffect(() => {
    if (initialPrompt && sentInitial.current !== initialPrompt && status?.configured && status.limits.enabled) {
      sentInitial.current = initialPrompt;
      void send(initialPrompt);
    }
  }, [initialPrompt, status, send]);

  async function decide(action: Action, approve: boolean) {
    if (
      approve &&
      !(await confirm({
        title: action.preview.title + "?",
        body: (
          <div className="as-confirm">
            <p>{action.preview.summary}</p>
            {action.preview.details.map((d) => (
              <p key={d.label}>
                <b>{d.label}:</b> {d.value}
              </p>
            ))}
          </div>
        ),
        confirmLabel: action.preview.confirmLabel,
        danger: action.preview.danger,
      }))
    )
      return;
    setDeciding(action.id);
    setActions((prev) => ({ ...prev, [action.id]: { ...action, status: approve ? "approved" : action.status } }));
    try {
      const r = await fetch("/api/assistant/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: action.id, decision: approve ? "approve" : "reject" }),
      });
      const d = await r.json();
      if (d.status) {
        setActions((prev) => ({
          ...prev,
          [action.id]: { ...action, status: d.status, result: d.message ? { message: d.message } : null, error: d.error },
        }));
        if (d.status === "succeeded") toast.show(d.message);
        if (d.status === "failed") toast.show(d.error, true);
      } else {
        setActions((prev) => ({ ...prev, [action.id]: { ...action, status: r.status === 409 && /expired/i.test(d.error) ? "expired" : action.status } }));
        toast.show(d.error || "That action couldn’t be updated.", true);
      }
    } catch {
      setActions((prev) => ({ ...prev, [action.id]: action }));
      toast.show("Connection lost. Check the action’s status before trying again.", true);
    } finally {
      setDeciding("");
    }
  }

  const unavailable = status && (!status.configured || !status.limits.enabled);
  const atLimit = status && status.used.today >= status.limits.dailyRequests;
  return (
    <div className="as-chat">
      <div className="as-log" ref={scroller} role="log" aria-live="polite" aria-busy={sending}>
        {loading && <Skeleton rows={4} />}
        {!loading && !items.length && (
          <div className="as-welcome">
            <span className="as-welcome-mark">
              <Icon name="sparkles" size={22} />
            </span>
            <h2>{context?.label ? `Ask about ${context.label}` : "How can I help today?"}</h2>
            <p>
              I can look up appointments, clients, documents and jobs, find open time, and prepare messages or changes for you to
              approve. Nothing is sent or changed until you confirm it.
            </p>
            {!unavailable && (
              <div className="as-prompts">
                {promptsFor(context).map((p) => (
                  <button key={p} type="button" className="as-prompt" disabled={sending || !!atLimit} onClick={() => void send(p)}>
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {items.map((item) =>
          item.role === "user" ? (
            <div key={item.key} className="as-msg as-msg-user">
              <p>{item.text}</p>
            </div>
          ) : item.role === "outcome" ? (
            <p key={item.key} className="as-outcome">
              <Icon name="check" size={13} /> {item.text}
            </p>
          ) : (
            <div key={item.key} className="as-msg as-msg-assistant">
              {item.tools.length > 0 && (
                <div className="as-tools">
                  {item.tools.map((t, i) => (
                    <span key={i} className={`as-tool ${t.status === "error" ? "error" : ""}`} title={t.detail}>
                      <Icon name={t.status === "error" ? "close" : "check"} size={12} />
                      {t.label || toolLabels[t.name] || t.name.replaceAll("_", " ")}
                    </span>
                  ))}
                </div>
              )}
              {item.text ? (
                <div className="as-text">
                  <Rich text={item.text} />
                </div>
              ) : (
                item.streaming && (
                  <div className="as-typing" aria-label="Assistant is working">
                    <span />
                    <span />
                    <span />
                  </div>
                )
              )}
              {item.actions.map((id) =>
                actions[id] ? <ActionCard key={id} action={actions[id]} onDecide={decide} busy={deciding === id} /> : null,
              )}
              {item.error && (
                <div className="as-error" role="alert">
                  <span>{item.error.message}</span>
                  {item.error.retryable && !sending && (
                    <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => void send(lastPrompt.current)}>
                      Retry
                    </button>
                  )}
                </div>
              )}
            </div>
          ),
        )}
      </div>
      {status && !status.configured && (
        <Alert tone="info" title="The assistant isn’t set up yet">
          A platform administrator needs to add the Anthropic API key in Admin → Operations → Integrations.
        </Alert>
      )}
      {status && status.configured && !status.limits.enabled && (
        <Alert tone="warning" title="The assistant is turned off for this account" />
      )}
      {atLimit && status?.configured && (
        <Alert tone="warning" title="Daily limit reached">
          You’ve used all {status.limits.dailyRequests} assistant requests for today. The limit resets at midnight UTC.
        </Alert>
      )}
      <form
        className="as-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          value={input}
          rows={1}
          maxLength={4000}
          placeholder={unavailable ? "The assistant is unavailable" : "Ask Zenvio anything about your business…"}
          aria-label="Message the assistant"
          disabled={!!unavailable || !!atLimit}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <button
          type="submit"
          className="ui-btn ui-btn-primary ui-btn-icon"
          aria-label="Send"
          disabled={sending || !input.trim() || !!unavailable || !!atLimit}
        >
          <Icon name="send" size={16} />
        </button>
      </form>
      <p className="as-footnote">
        AI can make mistakes. Review every preview before you approve it. Not legal, tax or financial advice.{" "}
        <Link href="/privacy#ai">How your data is used</Link>
      </p>
      {confirmNode}
      {toast.node}
    </div>
  );
}

function useAssistantStatus(active: boolean) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(() => {
    fetch("/api/assistant", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setStatus(d);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (active) refresh();
  }, [active, refresh]);
  return { status, error, refresh };
}

export function AssistantLauncher() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false),
    [conversation, setConversation] = useState<string | null>(null),
    [context, setContext] = useState<AssistantContextRef | undefined>(),
    [prompt, setPrompt] = useState<string | undefined>(),
    // Remounts the chat only for an explicit new conversation, never when a stream assigns an id.
    [chatKey, setChatKey] = useState(0);
  const { status, error, refresh } = useAssistantStatus(open);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const listen = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      opener.current = document.activeElement as HTMLElement;
      if (detail.context || detail.prompt) {
        setConversation(null);
        setChatKey((k) => k + 1);
      }
      setContext(detail.context);
      setPrompt(detail.prompt);
      setOpen(true);
    };
    window.addEventListener("zenvio:assistant", listen);
    return () => window.removeEventListener("zenvio:assistant", listen);
  }, []);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) setOpen(false);
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      opener.current?.focus?.();
    };
  }, [open]);
  if (pathname.startsWith("/app/assistant")) return null;
  return (
    <>
      {!open && (
        <button
          type="button"
          className="as-launcher"
          onClick={(e) => {
            opener.current = e.currentTarget;
            setOpen(true);
          }}
          aria-label="Open Zenvio Assistant"
        >
          <Icon name="sparkles" size={18} />
          <span>Ask Zenvio</span>
        </button>
      )}
      {open && (
        <div className="as-panel" role="dialog" aria-modal="false" aria-label="Zenvio Assistant" ref={panel}>
          <header className="as-panel-head">
            <span className="as-panel-title">
              <Icon name="sparkles" size={16} /> Zenvio Assistant
            </span>
            {context?.label && (
              <span className="as-context-chip" title="The assistant can see this record">
                {context.label}
                <button type="button" aria-label="Remove page context" onClick={() => setContext(undefined)}>
                  <Icon name="close" size={11} />
                </button>
              </span>
            )}
            <div className="as-panel-actions">
              <button
                type="button"
                className="ui-btn ui-btn-ghost ui-btn-icon ui-btn-sm"
                aria-label="New conversation"
                title="New conversation"
                onClick={() => {
                  setConversation(null);
                  setPrompt(undefined);
                  setChatKey((k) => k + 1);
                }}
              >
                <Icon name="plus" size={15} />
              </button>
              <Link
                href={conversation ? `/app/assistant?c=${conversation}` : "/app/assistant"}
                className="ui-btn ui-btn-ghost ui-btn-icon ui-btn-sm"
                aria-label="Open full page"
                title="Open full page"
                onClick={() => setOpen(false)}
              >
                <Icon name="external" size={15} />
              </Link>
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-icon ui-btn-sm" aria-label="Close assistant" onClick={() => setOpen(false)}>
                <Icon name="close" size={15} />
              </button>
            </div>
          </header>
          {error ? (
            <div className="as-panel-error">
              <Alert tone="danger">{error}</Alert>
            </div>
          ) : (
            <AssistantChat
              key={chatKey}
              conversationId={conversation}
              onConversation={setConversation}
              context={context}
              initialPrompt={prompt}
              status={status}
              onStatusChange={refresh}
            />
          )}
        </div>
      )}
    </>
  );
}

export function AssistantWorkspace({ initialConversation }: { initialConversation?: string }) {
  const [conversation, setConversation] = useState<string | null>(initialConversation || null);
  const { status, error, refresh } = useAssistantStatus(true);
  const [showHistory, setShowHistory] = useState(false);
  const [chatKey, setChatKey] = useState(0);
  const toast = useToast();
  const { confirm, node: confirmNode } = useConfirm();
  const choose = (id: string | null) => {
    setConversation(id);
    setChatKey((k) => k + 1);
    setShowHistory(false);
    window.history.replaceState(null, "", id ? `/app/assistant?c=${id}` : "/app/assistant");
  };
  async function remove(id: string) {
    if (!(await confirm({ title: "Delete this conversation?", body: "Its messages are removed. Completed actions stay in your records.", confirmLabel: "Delete", danger: true })))
      return;
    const r = await fetch(`/api/assistant?conversation=${id}`, { method: "DELETE" });
    if (!r.ok) return toast.show("Couldn’t delete the conversation.", true);
    if (conversation === id) choose(null);
    refresh();
  }
  const history: ReactNode = (
    <aside className={`as-history${showHistory ? " open" : ""}`} aria-label="Conversation history">
      <button type="button" className="ui-btn ui-btn-primary as-new" onClick={() => choose(null)}>
        <Icon name="plus" size={15} /> New conversation
      </button>
      {!status && !error && <Skeleton rows={3} />}
      {status && !status.conversations.length && <p className="as-history-empty">Your conversations appear here.</p>}
      <ul>
        {status?.conversations.map((c) => (
          <li key={c.id} className={c.id === conversation ? "active" : ""}>
            <button type="button" onClick={() => choose(c.id)}>
              <span>{c.title}</span>
              <small>{formatDateTime(c.updated_at)}</small>
            </button>
            <button type="button" className="as-history-delete" aria-label={`Delete ${c.title}`} onClick={() => void remove(c.id)}>
              <Icon name="close" size={13} />
            </button>
          </li>
        ))}
      </ul>
      {status && status.configured && (
        <div className="as-usage">
          <span>
            Today: {status.used.today} of {status.limits.dailyRequests} requests
          </span>
          <Meter value={status.used.today} max={status.limits.dailyRequests} label="Assistant requests used today" />
        </div>
      )}
    </aside>
  );
  return (
    <div className="platform-page as-page">
      <div className="as-page-head">
        <div>
          <h1>Assistant</h1>
          <p>Ask questions about your schedule, clients and documents. You approve every message and change before it happens.</p>
        </div>
        <button type="button" className="ui-btn ui-btn-secondary as-history-toggle" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
          History
        </button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="as-workspace">
        {history}
        <section className="as-main">
          {status ? (
            <AssistantChat
              key={chatKey}
              conversationId={conversation}
              onConversation={(id) => {
                if (id) window.history.replaceState(null, "", `/app/assistant?c=${id}`);
                setConversation(id);
                refresh();
              }}
              status={status}
              onStatusChange={refresh}
            />
          ) : (
            !error && <EmptyState icon="sparkles" title="Loading the assistant…" />
          )}
        </section>
      </div>
      {confirmNode}
      {toast.node}
    </div>
  );
}
