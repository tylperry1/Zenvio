"use client";
import { Badge, Kpi, Notice, Panel, formatDate, relativeTime } from "./ds";
import { Icon } from "./icons";

type Props = {
  health: Record<string, { ok: boolean; latencyMs?: number }>;
  details: {
    checkedAt: string;
    nodeVersion: string;
    environment: string;
    migrationCount: number;
    lastMigration: string | null;
    lastMigrationAt: string | null;
    oldestPendingEmail: string | null;
    lastEmailSent: string | null;
  };
  delivery: { pending: number; sent: number; failed: number };
  diagnostics?: { configured?: boolean; senderDomain: string | null; credentialStatus: string; domainStatus: string; issue: string | null };
  providers: { key: string; label: string; configured: boolean }[];
  onRefresh: () => void;
  busy?: boolean;
};

const human = (s: string) => s.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
const providerNames: Record<string, string> = {
  RESEND_API_KEY: "Resend email",
  STRIPE_SECRET_KEY: "Stripe billing",
  STRIPE_WEBHOOK_SECRET: "Stripe subscription webhooks",
  STRIPE_MARKETPLACE_WEBHOOK_SECRET: "Stripe marketplace webhooks",
  GOOGLE_CLIENT_ID: "Google Calendar",
  MICROSOFT_CLIENT_ID: "Microsoft 365",
  TWILIO_ACCOUNT_SID: "Twilio SMS",
  TURNSTILE_SECRET_KEY: "Turnstile CAPTCHA",
  ANTHROPIC_API_KEY: "Zenvio Assistant",
};

export function AdminHealth({ health, details, delivery, diagnostics, providers, onRefresh, busy }: Props) {
  const core = [
    { name: "Database", ok: health.database?.ok, detail: health.database?.latencyMs !== undefined ? `${health.database.latencyMs} ms round trip` : "Connection check" },
    { name: "Secret encryption", ok: health.encryption?.ok, detail: health.encryption?.ok ? "Integration vault can encrypt and decrypt" : "INTEGRATION_ENCRYPTION_KEY is missing" },
    {
      name: "Email delivery",
      ok: !!diagnostics?.configured && !diagnostics.issue && !["rejected", "unavailable"].includes(diagnostics.credentialStatus),
      detail: !diagnostics?.configured ? "Resend key or sender address not set" : diagnostics.issue || `Sending from ${diagnostics.senderDomain}`,
    },
  ];
  const issues = core.filter((c) => !c.ok).length + (delivery.failed ? 1 : 0);
  const shown = providers.filter((p) => providerNames[p.key]);
  return (
    <div className="ds-root hl">
      <div className="hl-banner" data-ok={issues === 0}>
        <span className="hl-banner-icon"><Icon name={issues ? "shield" : "check"} size={18} /></span>
        <div>
          <b>{issues ? issues === 1 ? "1 item needs attention" : `${issues} items need attention` : "All core systems operational"}</b>
          <p>Checked {relativeTime(details.checkedAt)} · {details.environment} · Node {details.nodeVersion.replace(/^v/, "")}</p>
        </div>
        <button className="ds-btn sm" onClick={onRefresh} disabled={busy}>
          <Icon name="clock" size={14} /> Refresh
        </button>
      </div>

      <div className="ds-kpis">
        <Kpi label="Emails delivered" icon="mail" value={delivery.sent.toLocaleString()} detail={details.lastEmailSent ? `Last sent ${relativeTime(details.lastEmailSent)}` : "No deliveries yet"} />
        <Kpi
          label="Waiting to send"
          icon="clock"
          value={delivery.pending.toLocaleString()}
          tone={delivery.pending > 25 ? "warning" : undefined}
          detail={details.oldestPendingEmail ? `Oldest queued ${relativeTime(details.oldestPendingEmail)}` : "Queue is empty"}
        />
        <Kpi label="Retries exhausted" icon="bell" value={delivery.failed.toLocaleString()} tone={delivery.failed ? "danger" : undefined} detail={delivery.failed ? "Review in provider recovery" : "No failed deliveries"} />
        <Kpi label="Database migrations" icon="layers" value={details.migrationCount} detail={details.lastMigration ? `Latest ${details.lastMigration.replace(/\.sql$/, "")}` : "None applied"} />
      </div>

      <div className="ds-grid-2">
        <Panel title="Core services" description="Checked on every refresh of this page.">
          <ul className="hl-list">
            {core.map((c) => (
              <li key={c.name}>
                <span className={`hl-dot ${c.ok ? "ok" : "bad"}`} aria-hidden="true" />
                <span>
                  <b>{c.name}</b>
                  <small>{c.detail}</small>
                </span>
                <Badge tone={c.ok ? "success" : "warning"}>{c.ok ? "Operational" : "Setup required"}</Badge>
              </li>
            ))}
          </ul>
          {diagnostics && (
            <p className="hl-foot">
              Email credential check: {human(diagnostics.credentialStatus)} · Sending domain: {human(diagnostics.domainStatus)}
            </p>
          )}
        </Panel>
        <Panel title="Provider configuration" description="Credential presence only. Authorization is verified when a service is used.">
          <ul className="hl-list compact">
            {shown.map((p) => (
              <li key={p.key}>
                <span className={`hl-dot ${p.configured ? "ok" : ""}`} aria-hidden="true" />
                <span><b>{providerNames[p.key]}</b></span>
                <Badge tone={p.configured ? "success" : "neutral"}>{p.configured ? "Configured" : "Not set"}</Badge>
              </li>
            ))}
          </ul>
          <a className="hl-link" href="/admin/operations?section=integrations">
            Manage connections <Icon name="arrow" size={13} />
          </a>
        </Panel>
      </div>

      {diagnostics?.issue && <Notice tone="warning">{diagnostics.issue}</Notice>}

      <Panel title="Deployment" description="Runtime and schema details for support.">
        <dl className="ds-dl hl-dl">
          <div><dt>Environment</dt><dd>{details.environment}</dd></div>
          <div><dt>Runtime</dt><dd>Node {details.nodeVersion}</dd></div>
          <div><dt>Latest migration</dt><dd>{details.lastMigration || "None"}</dd></div>
          <div><dt>Applied</dt><dd>{details.lastMigrationAt ? formatDate(details.lastMigrationAt, { dateStyle: "medium", timeStyle: "short" }) : "—"}</dd></div>
        </dl>
      </Panel>
    </div>
  );
}
