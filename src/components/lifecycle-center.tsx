"use client";
import { useEffect, useState } from "react";
import { IntakeEditor } from "./intake-editor";
import { SuiteShell } from "./suite-shell";
import { Icon } from "./icons";
import { Modal } from "./modal";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Skeleton,
  Tabs,
  Toggle,
  duration,
  formatDateTime,
  useToast,
} from "./ui";

type EventPolicy = {
  id: string;
  title: string;
  reminder_minutes: number[];
  cancellation_notice_minutes: number;
  reschedule_notice_minutes: number;
  intake_questions: any[];
};
type Job = {
  id: string;
  subject: string;
  recipient: string;
  run_at: string;
  sent_at?: string;
  status: string;
  provider_id?: string;
  provider_status?: string;
  last_error?: string;
  kind?: string;
};
type Rule = {
  id: string;
  name: string;
  trigger: string;
  action: string;
  event_id?: string;
  minutes: number;
  enabled: boolean;
};
type Tab = "policies" | "workflows" | "deliveries";

const reminderPresets = [15, 30, 60, 120, 240, 720, 1440, 2880, 4320, 10080];
const noticePresets = [0, 60, 120, 240, 720, 1440, 2880, 4320, 10080];
const triggers: Record<string, string> = {
  after_booking: "After an appointment is booked",
  before_appointment: "Before an appointment",
  after_appointment: "After an appointment",
  document_completed: "When a document is completed",
};
const actions: Record<string, [string, string]> = {
  email_guest: ["Email the guest", "mail"],
  email_host: ["Email me", "mail"],
  prepare_agreement: ["Prepare an agreement", "file"],
  send_agreement: ["Send an agreement", "file"],
  create_task: ["Create a client task", "check"],
};
// Pairs the workflow API accepts.
const allowedActions: Record<string, string[]> = {
  after_booking: ["email_guest", "email_host", "prepare_agreement", "send_agreement"],
  before_appointment: ["email_guest", "email_host"],
  after_appointment: ["email_guest", "email_host"],
  document_completed: ["email_host", "create_task"],
};
const statusTone = (s: string) =>
  s === "sent" || s === "succeeded" || s === "completed"
    ? "success"
    : s === "failed"
      ? "danger"
      : s === "cancelled" || s === "skipped"
        ? "neutral"
        : "info";
const label = (s: string) => s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());

export function LifecycleCenter() {
  const [data, setData] = useState<{ events: EventPolicy[]; jobs: Job[]; scheduler: any } | null>(null),
    [flows, setFlows] = useState<{ rules: Rule[]; runs: any[] } | null>(null),
    [templates, setTemplates] = useState<any[]>([]),
    [tab, setTab] = useState<Tab>("policies"),
    [editing, setEditing] = useState<EventPolicy | null>(null),
    [intake, setIntake] = useState<EventPolicy | null>(null),
    [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [loadError, setLoadError] = useState("");
  const toast = useToast();
  async function load() {
    const [r, f, t] = await Promise.all([
      fetch("/api/lifecycle", { cache: "no-store" }),
      fetch("/api/workflows", { cache: "no-store" }),
      fetch("/api/pdf-templates", { cache: "no-store" }),
    ]);
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    setData(d);
    setFlows(f.ok ? await f.json() : { rules: [], runs: [] });
    setTemplates(t.ok ? (await t.json()).templates || [] : []);
  }
  useEffect(() => {
    load().catch((e) => setLoadError(e.message));
  }, []);
  async function save(url: string, payload: unknown, success = "Saved.") {
    setBusy(true);
    try {
      const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      toast.show(success);
      await load();
      return true;
    } catch (e) {
      toast.show((e as Error).message, true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const scheduler = data?.scheduler;
  const failedJobs = data?.jobs.filter((j) => j.status === "failed").length || 0;
  return (
    <SuiteShell
      title="Reminders & workflows"
      description="Control reminder emails and booking rules for each appointment type, and automate what happens next."
      actions={
        scheduler && (
          <span className="lc-scheduler" title={scheduler.lastError || undefined}>
            <Badge tone={scheduler.healthy ? "success" : scheduler.configured ? "warning" : "neutral"}>
              <span className="ui-dot" />
              {scheduler.healthy
                ? "Automatic delivery on"
                : scheduler.configured
                  ? "Waiting for next delivery run"
                  : "Automatic delivery off"}
            </Badge>
            {scheduler.lastSuccess && (
              <small>Last run {formatDateTime(scheduler.lastSuccess)}</small>
            )}
          </span>
        )
      }
    >
      {loadError && (
        <Card>
          <EmptyState icon="shield" title="We couldn’t load this page">
            {loadError}
          </EmptyState>
        </Card>
      )}
      <Tabs
        label="Reminders and workflows"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "policies", label: "Appointment policies", count: data?.events.length },
          { id: "workflows", label: "Workflows", count: flows?.rules.length },
          { id: "deliveries", label: "Delivery log", count: failedJobs || undefined },
        ]}
      />
      {!data && !loadError && (
        <Card>
          <Skeleton rows={4} />
        </Card>
      )}

      {data && tab === "policies" && (
        <Card
          title="Appointment policies"
          description="Reminder emails go to guests automatically. Notice periods limit how late guests can cancel or reschedule from their private link."
          flush
        >
          {!data.events.length ? (
            <EmptyState icon="link" title="No appointment types yet">
              Create a booking link first, then set its reminders and rules here.
            </EmptyState>
          ) : (
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Appointment type</th>
                    <th>Reminders</th>
                    <th>Cancel notice</th>
                    <th>Reschedule notice</th>
                    <th>Intake questions</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((e) => (
                    <tr key={e.id}>
                      <td className="ui-cell-strong">{e.title}</td>
                      <td>
                        {e.reminder_minutes.length ? (
                          <span className="ui-chips">
                            {e.reminder_minutes.map((m) => (
                              <Badge key={m} tone="info">
                                {duration(m)} before
                              </Badge>
                            ))}
                          </span>
                        ) : (
                          <Badge>Off</Badge>
                        )}
                      </td>
                      <td>{e.cancellation_notice_minutes ? duration(e.cancellation_notice_minutes) : "Anytime"}</td>
                      <td>{e.reschedule_notice_minutes ? duration(e.reschedule_notice_minutes) : "Anytime"}</td>
                      <td>
                        <button className="lc-link" onClick={() => setIntake(e)}>
                          {e.intake_questions.length
                            ? `${e.intake_questions.length} question${e.intake_questions.length === 1 ? "" : "s"}`
                            : "Add questions"}
                        </button>
                      </td>
                      <td className="ui-cell-actions">
                        <button className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setEditing(e)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {data && tab === "workflows" && (
        <>
          <Card
            title="Workflows"
            description="Automate follow-ups after bookings, before or after appointments, and when documents are signed. New workflows start turned off so you can review them first."
            actions={
              <button className="ui-btn ui-btn-primary" onClick={() => setCreating(true)}>
                <Icon name="plus" size={15} /> New workflow
              </button>
            }
            flush
          >
            {!flows?.rules.length ? (
              <EmptyState
                icon="bell"
                title="No workflows yet"
                action={
                  <button className="ui-btn ui-btn-secondary" onClick={() => setCreating(true)}>
                    Create your first workflow
                  </button>
                }
              >
                For example, email guests a thank-you an hour after their appointment, or send an agreement as soon as
                someone books.
              </EmptyState>
            ) : (
              <ul className="ui-list">
                {flows.rules.map((r) => {
                  const [actionLabel, icon] = actions[r.action] || [label(r.action), "spark"];
                  const event = data.events.find((e) => e.id === r.event_id);
                  return (
                    <li key={r.id}>
                      <span className="ui-list-icon">
                        <Icon name={icon} size={17} />
                      </span>
                      <div className="ui-list-main">
                        <b>{r.name}</b>
                        <small>
                          {triggers[r.trigger] || label(r.trigger)}
                          {["before_appointment", "after_appointment"].includes(r.trigger) &&
                            ` · ${duration(r.minutes)} ${r.trigger === "before_appointment" ? "before" : "after"}`}
                          {" → "}
                          {actionLabel}
                          {" · "}
                          {event ? event.title : "All appointment types"}
                        </small>
                      </div>
                      <Badge tone={r.enabled ? "success" : "neutral"}>{r.enabled ? "On" : "Off"}</Badge>
                      <Toggle
                        label={`${r.enabled ? "Turn off" : "Turn on"} ${r.name}`}
                        checked={r.enabled}
                        disabled={busy}
                        onChange={(next) =>
                          void save(
                            "/api/workflows",
                            { action: "toggle", id: r.id, enabled: next },
                            next ? "Workflow turned on." : "Workflow turned off.",
                          )
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <Card title="Recent runs" description="The last 100 times a workflow ran." flush>
            {!flows?.runs.length ? (
              <EmptyState icon="clock" title="No runs yet">
                Runs appear here once a workflow is turned on and its trigger happens.
              </EmptyState>
            ) : (
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Workflow</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {flows.runs.map((r) => (
                      <tr key={r.id}>
                        <td>{formatDateTime(r.created_at)}</td>
                        <td className="ui-cell-strong">
                          {flows.rules.find((x) => x.id === r.rule_id)?.name || "Deleted workflow"}
                          {r.last_error && <span className="ui-cell-sub">{r.last_error}</span>}
                        </td>
                        <td>
                          <Badge tone={statusTone(r.status)}>{label(r.status)}</Badge>
                        </td>
                        <td className="ui-cell-actions">
                          {r.status === "failed" && (
                            <button
                              className="ui-btn ui-btn-secondary ui-btn-sm"
                              disabled={busy}
                              onClick={() => void save("/api/workflows", { action: "retry", id: r.id }, "Run queued again.")}
                            >
                              Retry
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {data && tab === "deliveries" && (
        <Card
          title="Delivery log"
          description="Confirmation, reminder, and workflow emails from the last 100 messages."
          actions={
            <button
              className="ui-btn ui-btn-secondary"
              disabled={busy}
              onClick={() => void save("/api/lifecycle", { action: "process" }, "Due messages processed.")}
            >
              <Icon name="spark" size={15} /> Send due messages now
            </button>
          }
          flush
        >
          {!data.jobs.length ? (
            <EmptyState icon="mail" title="No messages yet">
              Emails appear here as appointments are booked, changed, and reminded.
            </EmptyState>
          ) : (
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Message</th>
                    <th>Recipient</th>
                    <th>Scheduled</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.jobs.map((j) => (
                    <tr key={j.id}>
                      <td className="ui-cell-strong">
                        {j.subject}
                        {j.last_error && <span className="ui-cell-sub">{j.last_error}</span>}
                      </td>
                      <td>{j.recipient}</td>
                      <td>{formatDateTime(j.run_at)}</td>
                      <td>
                        <Badge tone={statusTone(j.status)}>{label(j.status)}</Badge>
                        {j.provider_status && (
                          <span className="ui-cell-sub">Provider: {j.provider_status}</span>
                        )}
                      </td>
                      <td className="ui-cell-actions">
                        {j.status === "failed" && (
                          <button
                            className="ui-btn ui-btn-secondary ui-btn-sm"
                            disabled={busy}
                            onClick={() => void save("/api/lifecycle", { action: "retry", id: j.id }, "Message queued again.")}
                          >
                            Retry
                          </button>
                        )}
                        {j.provider_id && (
                          <button
                            className="ui-btn ui-btn-ghost ui-btn-sm"
                            disabled={busy}
                            onClick={() =>
                              void save("/api/lifecycle", { action: "refresh_delivery", id: j.id }, "Delivery status updated.")
                            }
                          >
                            Check status
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {editing && (
        <PolicyModal
          event={editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={async (payload) => {
            if (await save("/api/lifecycle", { action: "policy", id: editing.id, ...payload }, "Policy saved."))
              setEditing(null);
          }}
        />
      )}
      {intake && (
        <Modal title={`Intake questions · ${intake.title}`} onClose={() => !busy && setIntake(null)}>
          <IntakeEditor
            event={intake}
            busy={busy}
            onCancel={() => setIntake(null)}
            onSave={async (questions) => {
              if (await save("/api/intake", { id: intake.id, questions }, "Intake questions saved.")) setIntake(null);
            }}
          />
        </Modal>
      )}
      {creating && data && (
        <WorkflowModal
          events={data.events}
          templates={templates.filter((t) => !t.archived)}
          busy={busy}
          onClose={() => setCreating(false)}
          onSave={async (payload) => {
            if (await save("/api/workflows", { ...payload, action: "create" }, "Workflow created. Turn it on when you’re ready."))
              setCreating(false);
          }}
        />
      )}
      {toast.node}
    </SuiteShell>
  );
}

function DurationSelect({
  value,
  presets,
  zeroLabel,
  onChange,
  name,
}: {
  value: number;
  presets: number[];
  zeroLabel?: string;
  onChange: (v: number) => void;
  name: string;
}) {
  const options = presets.includes(value) ? presets : [...presets, value].sort((a, b) => a - b);
  return (
    <select name={name} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {options.map((m) => (
        <option key={m} value={m}>
          {m === 0 ? zeroLabel : duration(m)}
        </option>
      ))}
    </select>
  );
}

function PolicyModal({
  event,
  busy,
  onClose,
  onSave,
}: {
  event: EventPolicy;
  busy: boolean;
  onClose: () => void;
  onSave: (p: { reminders: number[]; cancellation_notice: number; reschedule_notice: number }) => void;
}) {
  const [reminders, setReminders] = useState<number[]>(event.reminder_minutes);
  const [cancel, setCancel] = useState(event.cancellation_notice_minutes);
  const [move, setMove] = useState(event.reschedule_notice_minutes);
  return (
    <Modal title={`Policy · ${event.title}`} onClose={() => !busy && onClose()}>
      <form
        className="ui-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ reminders, cancellation_notice: cancel, reschedule_notice: move });
        }}
      >
        <div className="ui-field">
          <span className="ui-label">Reminder emails</span>
          <span className="ui-hint">Up to three, sent to the guest before the appointment.</span>
          <div className="lc-reminders">
            {reminders.map((m, i) => (
              <div key={i} className="lc-reminder">
                <DurationSelect
                  name={`reminder-${i}`}
                  value={m}
                  presets={reminderPresets}
                  onChange={(v) => setReminders(reminders.map((x, j) => (j === i ? v : x)))}
                />
                <span>before</span>
                <button
                  type="button"
                  className="ui-btn ui-btn-ghost ui-btn-icon"
                  aria-label="Remove reminder"
                  onClick={() => setReminders(reminders.filter((_, j) => j !== i))}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
            {!reminders.length && <p className="lc-muted">No reminders will be sent.</p>}
            {reminders.length < 3 && (
              <button
                type="button"
                className="ui-btn ui-btn-secondary ui-btn-sm"
                onClick={() =>
                  setReminders([...reminders, reminderPresets.find((p) => !reminders.includes(p)) || 60])
                }
              >
                <Icon name="plus" size={14} /> Add reminder
              </button>
            )}
          </div>
        </div>
        <div className="ui-form-grid">
          <Field label="Cancellation notice" hint="How close to the start guests can still cancel.">
            <DurationSelect name="cancel" value={cancel} presets={noticePresets} zeroLabel="Anytime" onChange={setCancel} />
          </Field>
          <Field label="Rescheduling notice" hint="How close to the start guests can still reschedule.">
            <DurationSelect name="move" value={move} presets={noticePresets} zeroLabel="Anytime" onChange={setMove} />
          </Field>
        </div>
        <div className="ui-modal-actions">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="ui-btn ui-btn-primary" disabled={busy || new Set(reminders).size !== reminders.length}>
            {busy ? "Saving…" : "Save policy"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function WorkflowModal({
  events,
  templates,
  busy,
  onClose,
  onSave,
}: {
  events: EventPolicy[];
  templates: { id: string; name: string }[];
  busy: boolean;
  onClose: () => void;
  onSave: (p: Record<string, unknown>) => void;
}) {
  const [trigger, setTrigger] = useState("after_booking");
  const [action, setAction] = useState("email_guest");
  const timed = ["before_appointment", "after_appointment"].includes(trigger);
  const agreement = ["prepare_agreement", "send_agreement"].includes(action);
  const email = ["email_guest", "email_host"].includes(action);
  return (
    <Modal title="New workflow" onClose={() => !busy && onClose()}>
      <form
        className="ui-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget));
          onSave({ ...f, trigger, workflow_action: action, minutes: Number(f.minutes || 0) });
        }}
      >
        <Field label="Name">
          <input name="name" required maxLength={100} placeholder="e.g. Thank-you note after a call" />
        </Field>
        <div className="ui-form-grid">
          <Field label="When">
            <select
              value={trigger}
              onChange={(e) => {
                setTrigger(e.target.value);
                if (!allowedActions[e.target.value].includes(action)) setAction(allowedActions[e.target.value][0]);
              }}
            >
              {Object.entries(triggers).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          {timed ? (
            <Field label={trigger === "before_appointment" ? "How long before" : "How long after"}>
              <select name="minutes" defaultValue={60}>
                {[0, 15, 30, 60, 120, 240, 1440, 2880, 10080].map((m) => (
                  <option key={m} value={m}>
                    {m ? duration(m) : "Right away"}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="For appointment type">
              <select name="event_id">
                <option value="">All appointment types</option>
                {events.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {timed && (
            <Field label="For appointment type" wide>
              <select name="event_id">
                <option value="">All appointment types</option>
                {events.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Do this" wide={!agreement}>
            <select value={action} onChange={(e) => setAction(e.target.value)}>
              {allowedActions[trigger].map((v) => [v, actions[v][0]] as const).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          {agreement && (
            <Field label="Using template">
              <select name="template_id" required>
                <option value="">Choose a PDF template</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <Field label={action === "create_task" ? "Task title" : email ? "Email subject" : "Document title"}>
          <input name="subject" required maxLength={150} />
        </Field>
        {email && (
          <Field label="Message" hint="Sent as plain text.">
            <textarea name="message" maxLength={2000} rows={4} />
          </Field>
        )}
        {agreement && (
          <p className="lc-muted">
            Before turning this on, check that the template has exactly one guest signer role.
          </p>
        )}
        <div className="ui-modal-actions">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="ui-btn ui-btn-primary" disabled={busy}>
            {busy ? "Creating…" : "Create workflow"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
