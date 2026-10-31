"use client";
import { useState } from "react";
import { Icon } from "./icons";

export type IntegrationField = {
  key: string;
  label: string;
  configured: boolean;
  updatedAt?: string;
};

type Provider = {
  id: string;
  name: string;
  category: string;
  monogram: string;
  tint: string;
  description: string;
  fields: { key: string; label: string; hint?: string; secret?: boolean }[];
  endpoints?: { label: string; path: string }[];
  docs?: { label: string; href: string };
  // Optional credentials do not count toward "connected".
  optional?: string[];
};

// Groups the raw credential keys into the services they unlock.
const providers: Provider[] = [
  {
    id: "resend",
    name: "Resend",
    category: "Email delivery",
    monogram: "R",
    tint: "#111827",
    description: "Account, booking, and reminder emails sent from your verified domain.",
    fields: [
      { key: "RESEND_API_KEY", label: "API key", secret: true },
      { key: "AUTH_EMAIL_FROM", label: "Verified sender", hint: "e.g. Zenvio <hello@gozenvio.com>", secret: false },
      { key: "RESEND_WEBHOOK_SECRET", label: "Webhook signing secret", secret: true },
    ],
    optional: ["RESEND_WEBHOOK_SECRET"],
    endpoints: [{ label: "Delivery webhook", path: "/api/messaging/resend" }],
    docs: { label: "Resend dashboard", href: "https://resend.com/api-keys" },
  },
  {
    id: "stripe",
    name: "Stripe",
    category: "Payments & billing",
    monogram: "S",
    tint: "#635bff",
    description: "Subscriptions, appointment deposits through Connect, and marketplace checkout.",
    fields: [
      { key: "STRIPE_SECRET_KEY", label: "Secret key", hint: "Use sk_test_ until billing is verified", secret: true },
      { key: "STRIPE_WEBHOOK_SECRET", label: "Subscription webhook secret", secret: true },
      { key: "STRIPE_CONNECT_WEBHOOK_SECRET", label: "Connect payments webhook secret", secret: true },
      { key: "STRIPE_MARKETPLACE_WEBHOOK_SECRET", label: "Marketplace webhook secret", secret: true },
    ],
    endpoints: [
      { label: "Subscriptions", path: "/api/billing/webhook" },
      { label: "Appointment payments", path: "/api/appointment-payments/webhook" },
      { label: "Marketplace", path: "/api/marketplace/webhook" },
    ],
    docs: { label: "Stripe API keys", href: "https://dashboard.stripe.com/apikeys" },
  },
  {
    id: "google",
    name: "Google Calendar",
    category: "Calendars",
    monogram: "G",
    tint: "#1a73e8",
    description: "Two-way availability sync and event creation for Google accounts.",
    fields: [
      { key: "GOOGLE_CLIENT_ID", label: "OAuth client ID", secret: false },
      { key: "GOOGLE_CLIENT_SECRET", label: "OAuth client secret", secret: true },
    ],
    endpoints: [{ label: "OAuth redirect URI", path: "/api/calendars/google/callback" }],
    docs: { label: "Google Cloud credentials", href: "https://console.cloud.google.com/apis/credentials" },
  },
  {
    id: "microsoft",
    name: "Microsoft 365",
    category: "Calendars",
    monogram: "M",
    tint: "#0078d4",
    description: "Outlook and Microsoft 365 calendar connections.",
    fields: [
      { key: "MICROSOFT_CLIENT_ID", label: "Application (client) ID", secret: false },
      { key: "MICROSOFT_CLIENT_SECRET", label: "Client secret", secret: true },
    ],
    endpoints: [{ label: "OAuth redirect URI", path: "/api/calendars/microsoft/callback" }],
    docs: { label: "Azure app registrations", href: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" },
  },
  {
    id: "twilio",
    name: "Twilio",
    category: "SMS messaging",
    monogram: "T",
    tint: "#f22f46",
    description: "Text reminders and two-way client messaging.",
    fields: [
      { key: "TWILIO_ACCOUNT_SID", label: "Account SID", secret: false },
      { key: "TWILIO_AUTH_TOKEN", label: "Auth token", secret: true },
      { key: "TWILIO_SENDER_NUMBER", label: "Sender number", hint: "E.164, e.g. +15551234567", secret: false },
      { key: "TWILIO_MESSAGING_SERVICE_SID", label: "Messaging service SID", secret: false },
    ],
    optional: ["TWILIO_SENDER_NUMBER", "TWILIO_MESSAGING_SERVICE_SID"],
    endpoints: [{ label: "Inbound & status webhook", path: "/api/messaging/twilio" }],
    docs: { label: "Twilio console", href: "https://console.twilio.com/" },
  },
  {
    id: "turnstile",
    name: "Cloudflare Turnstile",
    category: "Bot protection",
    monogram: "C",
    tint: "#f38020",
    description: "Invisible CAPTCHA on public booking pages.",
    fields: [
      { key: "TURNSTILE_SITE_KEY", label: "Site key", secret: false },
      { key: "TURNSTILE_SECRET_KEY", label: "Secret key", secret: true },
    ],
    docs: { label: "Turnstile dashboard", href: "https://dash.cloudflare.com/?to=/:account/turnstile" },
  },
  {
    id: "anthropic",
    name: "Anthropic",
    category: "AI",
    monogram: "A",
    tint: "#c96442",
    description: "Powers Zenvio Assistant drafting and summaries.",
    fields: [{ key: "ANTHROPIC_API_KEY", label: "API key", secret: true }],
    docs: { label: "Anthropic console", href: "https://console.anthropic.com/settings/keys" },
  },
];

type Status = "connected" | "partial" | "off";
function providerStatus(p: Provider, byKey: Map<string, IntegrationField>): Status {
  const required = p.fields.filter((f) => !p.optional?.includes(f.key));
  const done = required.filter((f) => byKey.get(f.key)?.configured).length;
  if (done === required.length) return "connected";
  return done || p.fields.some((f) => byKey.get(f.key)?.configured) ? "partial" : "off";
}
const statusText: Record<Status, string> = {
  connected: "Connected",
  partial: "Needs attention",
  off: "Not connected",
};
const when = (s?: string) =>
  s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";

export function AdminConnections({
  fields,
  emailDelivery,
  encryptionReady,
  busy,
  save,
}: {
  fields: IntegrationField[];
  emailDelivery: { pending: number; sent: number; failed: number };
  encryptionReady: boolean;
  busy: boolean;
  save: (input: unknown) => Promise<boolean>;
}) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const [filter, setFilter] = useState<"all" | "connected" | "attention">("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState("");
  const origin = typeof window === "undefined" ? "https://gozenvio.com" : window.location.origin;

  // Credentials added to the platform later still show up, in their own card.
  const known = new Set(providers.flatMap((p) => p.fields.map((f) => f.key)));
  const extra = fields.filter((f) => !known.has(f.key));
  const all: Provider[] = extra.length
    ? [
        ...providers,
        {
          id: "other",
          name: "Other credentials",
          category: "Platform",
          monogram: "+",
          tint: "#64748b",
          description: "Additional platform credentials.",
          fields: extra.map((f) => ({ key: f.key, label: f.label, secret: true })),
        },
      ]
    : providers;

  const statuses = new Map(all.map((p) => [p.id, providerStatus(p, byKey)]));
  const connected = all.filter((p) => statuses.get(p.id) === "connected").length;
  const q = query.trim().toLowerCase();
  const shown = all.filter(
    (p) =>
      (filter === "all" ||
        (filter === "connected" ? statuses.get(p.id) === "connected" : statuses.get(p.id) !== "connected")) &&
      (!q || `${p.name} ${p.category} ${p.fields.map((f) => f.label).join(" ")}`.toLowerCase().includes(q)),
  );

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(""), 1600);
    } catch {
      /* clipboard unavailable: the value stays visible to select manually */
    }
  }

  return (
    <div className="cx">
      <div className="cx-summary">
        <article>
          <span className="cx-summary-icon"><Icon name="plug" size={17} /></span>
          <div>
            <small>Services connected</small>
            <b>
              {connected}<span> / {all.length}</span>
            </b>
            <div className="cx-meter" aria-hidden="true">
              <i style={{ width: `${(connected / Math.max(1, all.length)) * 100}%` }} />
            </div>
          </div>
        </article>
        <article>
          <span className="cx-summary-icon"><Icon name="mail" size={17} /></span>
          <div>
            <small>Booking email</small>
            <b>{emailDelivery.sent.toLocaleString()}<span> sent</span></b>
            <p>
              {emailDelivery.pending} pending ·{" "}
              <em className={emailDelivery.failed ? "bad" : ""}>{emailDelivery.failed} exhausted</em>
            </p>
          </div>
        </article>
        <article>
          <span className={`cx-summary-icon ${encryptionReady ? "ok" : "bad"}`}><Icon name="shield" size={17} /></span>
          <div>
            <small>Secret vault</small>
            <b>{encryptionReady ? "Encrypted" : "Locked"}</b>
            <p>{encryptionReady ? "AES-256-GCM at rest · write-only" : "Set INTEGRATION_ENCRYPTION_KEY to save"}</p>
          </div>
        </article>
      </div>

      <div className="cx-toolbar">
        <div className="cx-filters" role="group" aria-label="Filter connections">
          {(
            [
              ["all", `All (${all.length})`],
              ["connected", `Connected (${connected})`],
              ["attention", `Needs setup (${all.length - connected})`],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
        <label className="cx-search">
          <Icon name="search" size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search services" aria-label="Search services" />
        </label>
      </div>

      <div className="cx-grid">
        {shown.map((p) => {
          const status = statuses.get(p.id)!;
          const expanded = open === p.id;
          const count = p.fields.filter((f) => byKey.get(f.key)?.configured).length;
          return (
            <section key={p.id} className={`cx-card ${expanded ? "open" : ""}`} data-status={status}>
              <button
                type="button"
                className="cx-card-head"
                aria-expanded={expanded}
                aria-controls={`cx-${p.id}`}
                onClick={() => setOpen(expanded ? null : p.id)}
              >
                <span className="cx-logo" style={{ background: p.tint }} aria-hidden="true">{p.monogram}</span>
                <span className="cx-card-title">
                  <b>{p.name}</b>
                  <small>{p.category}</small>
                </span>
                <span className={`cx-status ${status}`}>
                  <i />
                  {statusText[status]}
                </span>
              </button>
              <p className="cx-card-desc">{p.description}</p>
              <div className="cx-card-meta">
                <span>
                  {count} of {p.fields.length} credentials
                </span>
                <span className="cx-manage">
                  {expanded ? "Close" : status === "off" ? "Connect" : "Manage"}
                  <Icon name="chevronDown" size={14} />
                </span>
              </div>
              {expanded && (
                <div className="cx-card-body" id={`cx-${p.id}`}>
                  {p.fields.map((f) => {
                    const field = byKey.get(f.key);
                    if (!field) return null;
                    return (
                      <CredentialRow
                        key={f.key}
                        fieldKey={f.key}
                        label={f.label}
                        hint={f.hint}
                        secret={f.secret !== false}
                        optional={p.optional?.includes(f.key)}
                        configured={field.configured}
                        updatedAt={field.updatedAt}
                        disabled={busy || !encryptionReady}
                        save={(value) => save({ action: "integration", key: f.key, value })}
                      />
                    );
                  })}
                  {p.endpoints && (
                    <div className="cx-endpoints">
                      <h4>{p.id === "google" || p.id === "microsoft" ? "Register in the provider" : "Webhook endpoints"}</h4>
                      {p.endpoints.map((e) => {
                        const url = origin + e.path;
                        return (
                          <div key={e.path} className="cx-endpoint">
                            <span>{e.label}</span>
                            <code>{url}</code>
                            <button type="button" onClick={() => void copy(url)}>
                              {copied === url ? <><Icon name="check" size={14} /> Copied</> : "Copy"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {p.id === "resend" && (
                    <div className="cx-actions">
                      <button type="button" disabled={busy} onClick={() => void save({ action: "test-email" })}>
                        <Icon name="send" size={14} /> Send test email to me
                      </button>
                      <button type="button" disabled={busy} onClick={() => void save({ action: "retry-emails" })}>
                        <Icon name="mail" size={14} /> Process pending emails
                      </button>
                    </div>
                  )}
                  {p.id === "google" && (
                    <details className="cx-guide">
                      <summary>Setup guide</summary>
                      <ol>
                        <li>Enable the Google Calendar API in your Google Cloud project.</li>
                        <li>Configure the OAuth consent screen and create a Web application OAuth client.</li>
                        <li>Add the redirect URI above as an authorized redirect URI, then save the client ID and secret here.</li>
                        <li>In Testing mode, add your Google account as a test user. Public access may require Google app verification.</li>
                        <li>Open Dashboard → Settings → Calendar connections and connect your Google account.</li>
                      </ol>
                    </details>
                  )}
                  {p.docs && (
                    <a className="cx-docs" href={p.docs.href} target="_blank" rel="noopener noreferrer">
                      Open {p.docs.label} <Icon name="external" size={13} />
                    </a>
                  )}
                </div>
              )}
            </section>
          );
        })}
        {!shown.length && (
          <p className="cx-empty">No services match this filter.</p>
        )}
      </div>
      <p className="cx-footnote">
        <Icon name="shield" size={14} /> Values are encrypted at rest and never returned to this screen. Saving a value replaces the
        current one, so rotating a key is a single step. Calendar feed subscriptions are managed in workspace settings.
      </p>
    </div>
  );
}

function CredentialRow({
  fieldKey,
  label,
  hint,
  secret,
  optional,
  configured,
  updatedAt,
  disabled,
  save,
}: {
  fieldKey: string;
  label: string;
  hint?: string;
  secret: boolean;
  optional?: boolean;
  configured: boolean;
  updatedAt?: string;
  disabled: boolean;
  save: (value: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [editing, setEditing] = useState(!configured);
  return (
    <form
      className="cx-field"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await save(value)) {
          setValue("");
          setReveal(false);
          setEditing(false);
        }
      }}
    >
      <div className="cx-field-label">
        <label htmlFor={fieldKey}>
          {label}
          {optional && <span className="cx-optional">Optional</span>}
        </label>
        <small>
          {configured ? (
            <>
              <i className="cx-dot ok" /> Saved{updatedAt ? ` ${when(updatedAt)}` : " via environment"}
            </>
          ) : (
            <>
              <i className="cx-dot" /> Not set
            </>
          )}
          <code>{fieldKey}</code>
        </small>
      </div>
      {editing ? (
        <div className="cx-field-input">
          <div className="cx-input-wrap">
            <input
              id={fieldKey}
              name="value"
              type={secret && !reveal ? "password" : "text"}
              autoComplete="off"
              spellCheck={false}
              required
              maxLength={4096}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={hint || (configured ? "Paste a replacement value" : "Paste value")}
              autoFocus={configured}
            />
            {secret && (
              <button
                type="button"
                className="cx-reveal"
                onClick={() => setReveal((v) => !v)}
                aria-label={reveal ? "Hide value" : "Show value"}
              >
                {reveal ? "Hide" : "Show"}
              </button>
            )}
          </div>
          <button className="cx-save" disabled={disabled || !value.trim()}>
            Save
          </button>
          {configured && (
            <button type="button" className="cx-cancel" onClick={() => { setEditing(false); setValue(""); }}>
              Cancel
            </button>
          )}
        </div>
      ) : (
        <div className="cx-field-input">
          <span className="cx-masked" aria-label="Value hidden">••••••••••••</span>
          <button type="button" className="cx-rotate" onClick={() => setEditing(true)}>
            <Icon name="clock" size={14} /> Rotate
          </button>
        </div>
      )}
    </form>
  );
}
