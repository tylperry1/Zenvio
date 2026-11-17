"use client";

import { useEffect, useState } from "react";
import type { LaunchControls } from "@/lib/launch-controls";
import { PlatformSocialAdmin } from "./platform-social-admin";
import { Badge, Field, FormActions, Notice, PageHeader, Panel } from "./ds";
import { Skeleton, Toggle } from "./ui";

const registration = [
  ["signupEnabled", "Public signup", "Let new customers create a workspace."] as const,
  ["waitlistEnabled", "Waitlist", "Collect interest ahead of launch."] as const,
  ["invitationOnly", "Invitation-only beta", "Require an invitation when registration is open."] as const,
];

const operations = [
  ["checkoutEnabled", "Paid checkout", "Allow subscriptions after Stripe sandbox acceptance."] as const,
  ["maintenance", "Maintenance mode", "Pause public access while keeping admin and sign-in access."] as const,
  ["bannerEnabled", "Public launch banner", "Show your launch announcement on public pages."] as const,
];

const features = {
  smartCards: ["Smart Cards", "Digital profiles, QR codes and NFC products."] as const,
  growth: ["Marketing & growth", "Offers, campaigns and customer engagement."] as const,
  assistant: ["AI assistant", "Workspace assistant access, subject to existing limits."] as const,
};

function SettingRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="premium-setting-row">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <Toggle label={title} checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  );
}

export function LaunchControlAdmin() {
  const [sandboxRun, setSandboxRun] = useState("");
  const [controls, setControls] = useState<LaunchControls | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/admin/launch/controls")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setControls(d.controls);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function acceptance(action: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/admin/launch/stripe-sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, runId: sandboxRun, confirmation: "RUN_STRIPE_SANDBOX_ACCEPTANCE" }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (d.runId) setSandboxRun(d.runId);
      setMessage(d.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const statusTone = controls?.maintenance ? "warning" : "info";
  const statusLabel = !controls
    ? "Loading"
    : controls.maintenance
      ? "Maintenance active"
      : controls.invitationOnly
        ? "Invitation-only beta"
        : "Registration controls";

  return (
    <div className="ds-root premium-admin launch-command">
      <PageHeader
        eyebrow="Platform operations"
        title="Launch controls"
        description="Manage access, launch messaging and the features customers see."
        actions={<Badge tone={statusTone}>{statusLabel}</Badge>}
      />

      {error && <Notice tone="danger">{error}</Notice>}
      {message && (
        <div role="status">
          <Notice tone="success">{message}</Notice>
        </div>
      )}
      {!controls && !error && <Skeleton rows={6} />}

      {controls && (
        <form
          className="ds-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setMessage("");
            const reason = new FormData(e.currentTarget).get("reason");
            try {
              const r = await fetch("/api/admin/launch/controls", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ controls, reason }),
              });
              const d = await r.json();
              if (!r.ok) throw Error(d.error);
              setMessage("Launch controls saved.");
            } catch (cause) {
              setError((cause as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="command-summary">
            <div>
              <span>Scheduled launch</span>
              <strong>
                {Number.isFinite(Date.parse(controls.launchDate + "T12:00:00Z"))
                  ? new Intl.DateTimeFormat("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                      timeZone: "UTC",
                    }).format(new Date(controls.launchDate + "T12:00:00Z"))
                  : "Choose a launch date"}
              </strong>
            </div>
            <div>
              <span>New subscriptions</span>
              <strong>{controls.checkoutEnabled ? "Checkout enabled" : "Checkout paused"}</strong>
            </div>
            <div>
              <span>Existing customers</span>
              <strong>Sign-in remains available</strong>
            </div>
          </div>

          <div className="premium-settings-grid">
            <Panel title="Registration & access" description="Choose how new customers join Zenvio.">
              {registration.map(([key, title, description]) => (
                <SettingRow
                  key={key}
                  title={title}
                  description={description}
                  checked={controls[key]}
                  disabled={busy}
                  onChange={(value) => setControls({ ...controls, [key]: value })}
                />
              ))}
            </Panel>

            <Panel title="Platform availability" description="Control checkout and the public experience.">
              {operations.map(([key, title, description]) => (
                <SettingRow
                  key={key}
                  title={title}
                  description={description}
                  checked={controls[key]}
                  disabled={busy}
                  onChange={(value) => setControls({ ...controls, [key]: value })}
                />
              ))}
            </Panel>

            <Panel title="Launch announcement" description="A clear date and message for your public pages.">
              <div className="ds-form-grid">
                <Field label="Launch date">
                  <input
                    type="date"
                    required
                    disabled={busy}
                    value={controls.launchDate}
                    onChange={(e) => setControls({ ...controls, launchDate: e.target.value })}
                  />
                </Field>
                <Field label="Banner text">
                  <input
                    maxLength={180}
                    disabled={busy}
                    value={controls.banner}
                    onChange={(e) => setControls({ ...controls, banner: e.target.value })}
                  />
                </Field>
              </div>
            </Panel>

            <Panel title="Feature visibility" description="Keep navigation aligned with your rollout.">
              {(Object.keys(features) as (keyof typeof features)[]).map((key) => (
                <SettingRow
                  key={key}
                  title={features[key][0]}
                  description={features[key][1]}
                  disabled={busy}
                  checked={controls.features[key]}
                  onChange={(value) =>
                    setControls({ ...controls, features: { ...controls.features, [key]: value } })
                  }
                />
              ))}
              <p className="ds-muted">
                Manage commerce separately in{" "}
                <a href="/admin/operations?section=marketplace">Marketplace settings</a>.
              </p>
            </Panel>
          </div>

          <Panel title="Save changes" description="Record why these controls are changing for the audit history.">
            <Field label="Reason">
              <textarea
                name="reason"
                required
                minLength={5}
                maxLength={500}
                disabled={busy}
                placeholder="Describe the rollout or access change"
              />
            </Field>
            <FormActions>
              <span className="ds-muted">Changes take effect after saving.</span>
              <button className="ds-btn primary" disabled={busy}>
                {busy ? "Saving…" : "Save launch controls"}
              </button>
            </FormActions>
          </Panel>
        </form>
      )}

      <Panel
        title="Stripe sandbox acceptance"
        description="Verify the subscription lifecycle and signed webhook deliveries before enabling checkout."
      >
        <p className="ds-muted">
          Uses separate test credentials from <a href="/admin/operations?section=integrations">Connections</a>. No live
          charges are made.
        </p>
        <FormActions>
          <button className="ds-btn" disabled={busy} onClick={() => void acceptance("run")}>
            Run sandbox lifecycle
          </button>
          {sandboxRun && (
            <button className="ds-btn primary" disabled={busy} onClick={() => void acceptance("verify")}>
              Verify signed webhooks
            </button>
          )}
        </FormActions>
      </Panel>

      <PlatformSocialAdmin />
    </div>
  );
}
