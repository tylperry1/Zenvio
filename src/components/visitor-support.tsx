"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { supportCategories } from "@/lib/support-options";
import { Captcha, useCaptchaSiteKey } from "./captcha";
import { Badge, Notice, Skeleton } from "./ds";
import { Icon } from "./icons";
import { Availability, LiveControls, MessageList, useDraft, useLive, type Message } from "./platform-support";

type VisitorTicket = { id: string; subject: string; status: "open" | "pending" | "resolved"; rating: number | null; name: string; email: string };
type VisitorData = { ticket: VisitorTicket | null; messages?: { id: string; staff: boolean; content: string; created_at: string }[]; online: boolean };

const statusLabel = { open: "Waiting on Zenvio", pending: "Zenvio replied", resolved: "Resolved" } as const;

async function post(data: object) {
  const r = await fetch("/api/support/visitor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || "Something went wrong. Please try again.");
  return d;
}

function StartForm({ onStarted, compact }: { onStarted: () => void; compact?: boolean }) {
  const siteKey = useCaptchaSiteKey();
  const [form, setForm] = useState({ name: "", email: "", category: "other", subject: "", website: "" });
  const [captcha, setCaptcha] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const draft = useDraft();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <form
      className="sp-new"
      onSubmit={async (e) => {
        e.preventDefault();
        if (siteKey && !captcha) return setError("Please complete the verification.");
        setBusy(true);
        setError("");
        try {
          await post({ action: "create", ...form, content: draft.text, captcha, page: window.location.pathname, reference: draft.reference() });
          draft.clear();
          onStarted();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Your message couldn’t be sent.");
          setCaptcha("");
          setAttempt((n) => n + 1);
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && <Notice tone="danger">{error}</Notice>}
      <div className={compact ? "vc-grid compact" : "vc-grid"}>
        <label className="ds-field">
          <span>Your name</span>
          <input required maxLength={100} autoComplete="name" value={form.name} onChange={set("name")} />
        </label>
        <label className="ds-field">
          <span>Email</span>
          <input required type="email" maxLength={254} autoComplete="email" value={form.email} onChange={set("email")} />
        </label>
      </div>
      <label className="ds-field">
        <span>Topic</span>
        <select value={form.category} onChange={set("category")}>
          {supportCategories.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="ds-field">
        <span>Subject</span>
        <input required maxLength={150} value={form.subject} onChange={set("subject")} placeholder="A few words about your question" />
      </label>
      <label className="ds-field">
        <span>Message</span>
        <textarea required rows={compact ? 3 : 5} maxLength={4000} value={draft.text} onChange={(e) => draft.setText(e.target.value)} />
        <small>We’ll reply here and email you a private link. Don’t include passwords or card numbers.</small>
      </label>
      {/* Hidden from people; bots that fill it are rejected. */}
      <label className="vc-hp" aria-hidden="true">
        Website
        <input tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
      </label>
      {siteKey && <Captcha siteKey={siteKey} onToken={setCaptcha} resetKey={attempt} />}
      <button className="ds-btn primary" disabled={busy}>
        <Icon name="send" size={15} /> {busy ? "Sending…" : "Start chat"}
      </button>
      <p className="vc-fineprint">
        Have an account? <Link href="/sign-in">Sign in</Link> to chat from your workspace. See our <Link href="/privacy">privacy policy</Link>.
      </p>
    </form>
  );
}

/** Chat for website visitors who aren't signed in. */
export function VisitorChat({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<VisitorData | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const draft = useDraft();
  const load = useCallback(async () => {
    const r = await fetch("/api/support/visitor", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setError(d.error || "Chat couldn’t be loaded.");
    setError("");
    setData(d);
  }, []);
  useEffect(() => {
    (async () => {
      // A reply-email link carries the conversation token in the URL fragment.
      const token = window.location.hash.slice(1);
      if (/^[A-Za-z0-9_-]{43}$/.test(token)) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        await post({ action: "resume", token }).catch((e) => setError(e.message));
      }
      const me = await fetch("/api/support", { cache: "no-store" }).catch(() => null);
      setSignedIn(!!me?.ok);
      await load();
    })();
  }, [load]);
  const live = useLive(data?.ticket ? "/api/support/visitor/stream" : null, () => void load());
  const pollRef = useRef(load);
  pollRef.current = load;
  useEffect(() => {
    if (!data?.ticket) return;
    const timer = window.setInterval(() => document.visibilityState === "visible" && void pollRef.current(), live === "live" ? 30000 : 5000);
    return () => window.clearInterval(timer);
  }, [data?.ticket, live]);

  if (signedIn)
    return (
      <div className="vc-signed-in">
        <p>You’re signed in. Chat with the team from your workspace so your conversations stay in one place.</p>
        <Link href="/app/support" className="ds-btn primary">
          <Icon name="message" size={15} /> Open Zenvio support
        </Link>
      </div>
    );
  if (!data)
    return error ? (
      <Notice tone="danger">{error}</Notice>
    ) : (
      <div aria-busy="true">
        <Skeleton height={18} width="60%" />
        <Skeleton height={80} />
      </div>
    );
  if (!data.ticket)
    return (
      <div className="vc-body">
        {error && <Notice tone="danger">{error}</Notice>}
        <Availability online={data.online} />
        <StartForm compact={compact} onStarted={load} />
      </div>
    );
  const t = data.ticket;
  const messages: Message[] = (data.messages || []).map((m) => ({ ...m, sender_id: null, internal: false, attachment: false }));
  async function submit() {
    if (!draft.text.trim() || busy) return;
    setBusy(true);
    try {
      await post({ action: "message", content: draft.text.trim(), reference: draft.reference() });
      draft.clear();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="sp-thread vc-thread">
      <header className="sp-thread-head">
        <div>
          <h2>{t.subject}</h2>
          <p>Replies are also emailed to {t.email}.</p>
        </div>
        <Badge tone={t.status === "resolved" ? "success" : t.status === "pending" ? "warning" : "info"}>{statusLabel[t.status]}</Badge>
      </header>
      <div className="vc-toolbar">
        <Availability online={data.online} />
        <LiveControls state={live} onRefresh={load} />
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      <MessageList messages={messages} staff={false} endpoint="/api/support/visitor" />
      {t.status === "resolved" &&
        (t.rating ? (
          <p className="sp-rated">You rated this conversation {t.rating} out of 5. Thank you.</p>
        ) : (
          <div className="sp-rating">
            <span>How did we do?</span>
            <div role="group" aria-label="Rate this conversation">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" aria-label={`${n} out of 5`} onClick={() => post({ action: "rate", rating: n }).then(load, (e) => setError(e.message))}>
                  <span aria-hidden="true">★</span>
                </button>
              ))}
            </div>
          </div>
        ))}
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
          <button
            type="button"
            className="ds-btn ghost sm"
            onClick={async () => {
              if (!window.confirm("Start a new conversation? You can still reach this one from the link in your email.")) return;
              await post({ action: "leave" }).catch(() => {});
              await load();
            }}
          >
            New conversation
          </button>
          {t.status !== "resolved" && (
            <button type="button" className="ds-btn ghost sm" onClick={() => post({ action: "resolve" }).then(load, (e) => setError(e.message))}>
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

/** Floating "Chat with us" button for public pages. */
export function VisitorChatWidget() {
  const [open, setOpen] = useState(false);
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
  return (
    <>
      {!open && (
        <button ref={button} type="button" className="vc-launcher" aria-expanded={false} aria-controls="zenvio-visitor-chat" onClick={() => setOpen(true)}>
          <Icon name="message" size={18} />
          <span>Chat with us</span>
        </button>
      )}
      {open && (
        <div id="zenvio-visitor-chat" className="ds-root sp-panel vc-panel" role="dialog" aria-label="Chat with Zenvio">
          <header className="sp-panel-head">
            <b>
              <Icon name="message" size={16} /> Chat with Zenvio
            </b>
            <span>
              <Link href="/support" className="sp-expand">
                Open full page
              </Link>
              <button type="button" aria-label="Close chat" onClick={() => setOpen(false)}>
                <Icon name="close" size={16} />
              </button>
            </span>
          </header>
          <div className="sp-panel-body">
            <VisitorChat compact />
          </div>
        </div>
      )}
    </>
  );
}
