"use client";
import { useEffect, useState } from "react";
import { IntakeEditor } from "./intake-editor";
import { SuiteShell } from "./suite-shell";
export function LifecycleCenter() {
  const [data, setData] = useState<any>(null),
    [flows, setFlows] = useState<any>(null),
    [templates, setTemplates] = useState<any[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function load() {
    const r = await fetch("/api/lifecycle"),
      d = await r.json();
    if (!r.ok) throw Error(d.error);
    setData(d);
    const f = await fetch("/api/workflows");
    setFlows(await f.json());
    const t = await fetch("/api/pdf-templates");
    setTemplates((await t.json()).templates || []);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function save(url: string, payload: any) {
    setError("");
    try {
      const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      setMessage("Saved successfully.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <SuiteShell
      title="Reminders & workflows"
      description="Set appointment policies, collect intake details, and automate the next step."
    >
      {error && (
        <p role="alert" className="billing-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {data && !data.preciseSchedulingConfigured && (
        <p className="billing-note">
          Minute-level scheduling is not configured. Jobs are durable and can be
          processed manually; an administrator must connect a frequent scheduler
          before relying on timed delivery.
        </p>
      )}
      {data?.events.map((e: any) => (
        <section key={e.id}>
          <h2>{e.title}</h2>
          <form
            className="suite-grid"
            onSubmit={(ev) => {
              ev.preventDefault();
              const f = new FormData(ev.currentTarget);
              void save("/api/lifecycle", {
                action: "policy",
                id: e.id,
                reminders: String(f.get("reminders"))
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map(Number),
                cancellation_notice: Number(f.get("cancel")),
                reschedule_notice: Number(f.get("move")),
              });
            }}
          >
            <label>
              Reminder minutes before appointment
              <input
                name="reminders"
                defaultValue={e.reminder_minutes.join(",")}
                placeholder="1440,60"
              />
              <small>Up to three values. Leave empty to disable.</small>
            </label>
            <label>
              Cancellation notice (minutes)
              <input
                name="cancel"
                type="number"
                min={0}
                max={10080}
                defaultValue={e.cancellation_notice_minutes}
              />
            </label>
            <label>
              Rescheduling notice (minutes)
              <input
                name="move"
                type="number"
                min={0}
                max={10080}
                defaultValue={e.reschedule_notice_minutes}
              />
            </label>
            <button>Save policy</button>
          </form>
          <details>
            <summary>Custom intake questions</summary>
            <IntakeEditor
              event={e}
              onSave={(questions) =>
                save("/api/intake", { id: e.id, questions })
              }
            />
          </details>
        </section>
      ))}
      <section>
        <h2>Workflows</h2>
        <p>
          New rules start disabled. Before enabling automatic agreements, review
          the single guest role in your template. Rules apply to new
          appointments and completed documents after the rule was created.
        </p>
        {flows?.rules?.map((r: any) => (
          <article className="suite-row" key={r.id}>
            <div>
              <strong>{r.name}</strong>
              <small>
                {r.trigger} → {r.action}
              </small>
            </div>
            <button
              onClick={() =>
                save("/api/workflows", {
                  action: "toggle",
                  id: r.id,
                  enabled: !r.enabled,
                })
              }
            >
              {r.enabled ? "Disable" : "Enable"}
            </button>
          </article>
        ))}
        <details>
          <summary>Create workflow</summary>
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget));
              void save("/api/workflows", {
                ...f,
                action: "create",
                minutes: Number(f.minutes),
              });
            }}
          >
            <label>
              Name
              <input name="name" required maxLength={100} />
            </label>
            <label>
              Trigger
              <select name="trigger">
                {[
                  "after_booking",
                  "before_appointment",
                  "after_appointment",
                  "document_completed",
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Action
              <select name="workflow_action">
                {[
                  "email_guest",
                  "email_host",
                  "prepare_agreement",
                  "send_agreement",
                  "create_task",
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Appointment type
              <select name="event_id">
                <option value="">All my appointment types</option>
                {data?.events.map((v: any) => (
                  <option key={v.id} value={v.id}>
                    {v.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Template
              <select name="template_id">
                <option value="">No template</option>
                {templates
                  .filter((t) => !t.archived)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Minutes before/after appointment
              <input
                name="minutes"
                type="number"
                defaultValue={60}
                min={0}
                max={10080}
              />
            </label>
            <label>
              Subject / task title
              <input name="subject" required maxLength={150} />
            </label>
            <label>
              Message
              <textarea name="message" maxLength={2000} />
            </label>
            <button>Create disabled workflow</button>
          </form>
        </details>
      </section>
      <section>
        <h2>Delivery queue</h2>
        <button onClick={() => save("/api/lifecycle", { action: "process" })}>
          Process due jobs
        </button>
        <div className="suite-table">
          {data?.jobs.map((j: any) => (
            <article className="suite-row" key={j.id}>
              <div>
                <strong>{j.subject}</strong>
                <small>
                  {j.recipient} · Due {new Date(j.run_at).toLocaleString()}
                </small>
                <small>
                  {j.status}{" "}
                  {j.provider_status && "· Provider " + j.provider_status}{" "}
                  {j.last_error}
                </small>
              </div>
              {j.provider_id && (
                <button
                  onClick={() =>
                    save("/api/lifecycle", {
                      action: "refresh_delivery",
                      id: j.id,
                    })
                  }
                >
                  Refresh delivery status
                </button>
              )}
              {j.status === "failed" && (
                <button
                  onClick={() =>
                    save("/api/lifecycle", { action: "retry", id: j.id })
                  }
                >
                  Retry
                </button>
              )}
            </article>
          ))}
        </div>
      </section>
      <section>
        <h2>Workflow execution history</h2>
        {flows?.runs?.map((r: any) => (
          <p key={r.id}>
            {new Date(r.created_at).toLocaleString()} · {r.status}{" "}
            {r.last_error}
            {r.status === "failed" && (
              <button
                onClick={() =>
                  save("/api/workflows", { action: "retry", id: r.id })
                }
              >
                Retry execution
              </button>
            )}
          </p>
        ))}
      </section>
    </SuiteShell>
  );
}
